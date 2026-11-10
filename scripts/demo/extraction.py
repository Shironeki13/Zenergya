"""Classeur d'extraction des tables de la démo (données SIMULÉES) : un onglet sommaire, puis un onglet par composant
(collection Firestore), les lignes de facture détaillées et les fichiers du stockage.

    python3 scripts/demo/extraction.py demo-extraction.json demo-extraction.xlsx
(lancé par « npm run demo:extraction » ; nécessite openpyxl : pip install --user openpyxl)
"""
import json
import re
import sys
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SOURCE, SORTIE = (sys.argv[1:3] + ['demo-extraction.json', 'demo-extraction.xlsx'][len(sys.argv[1:3]):])[:2]

# Libellé et rôle de chaque composant (collection Firestore), par groupe.
COMPOSANTS = {
    'Référentiels': {
        'companies': ('Sociétés', 'Sociétés émettrices des factures (numérotation, mentions légales, paramètres de devis).'),
        'agencies': ('Agences', 'Agences d\'une société, avec leur code court (segment du code analytique) ; rattachement des clients.'),
        'sectors': ('Secteurs', 'Secteurs d\'une agence, avec leur code court (segment du code analytique) ; rattachement des clients.'),
        'typologies': ('Typologies de clients', 'Copropriété, bailleur, collectivité… ; régime de facturation électronique par défaut.'),
        'activities': ('Activités', 'Postes facturés (P1 fourniture d\'énergie, P2 conduite et entretien, P3 garantie totale) et TVA par défaut.'),
        'vatRates': ('Taux de TVA', 'Taux applicables aux prestations (taux en fraction : 0,2 = 20 %).'),
        'schedules': ('Périodicités', 'Échéanciers de facturation (mensuel, trimestriel, annuel).'),
        'terms': ('Termes', 'Terme de facturation : à échoir ou échu.'),
        'paymentTerms': ('Conditions de paiement', 'Délai de règlement des factures.'),
        'meterTypes': ('Types de compteurs', 'Gaz, calories, eau chaude, électricité, avec leur unité.'),
        'markets': ('Marchés', 'Marchés publics de rattachement des contrats.'),
        'config': ('Configuration', 'Compteurs internes des codes (CLI-, CTN-, SIT-, CPT-).'),
        'counters': ('Compteurs de numérotation', 'Dernier numéro de facture attribué, par société et mois.'),
    },
    'Clients et contrats': {
        'clients': ('Clients', 'Clients et prospects : identité, adresse, rattachement société / agence / secteur, représentant (syndic), Chorus.'),
        'contacts': ('Contacts', 'Interlocuteurs des clients (principal, facturation, technique).'),
        'contracts': ('Contrats', 'Contrats : client, dates, statut, validation (base marché), montants de base, activités, conditions.'),
        'sites': ('Sites', 'Sites d\'un contrat : adresse, montants annuels par activité.'),
        'services': ('Prestations', 'Prestations facturées par site et activité : montant annuel, périodicité, terme, compteur.'),
        'meters': ('Compteurs', 'Compteurs d\'un site (gaz, calories, ECS) : PCE, emplacement, statut.'),
        'meterReadings': ('Relevés', 'Relevés d\'index des compteurs (réels, estimés).'),
    },
    'Documents de contrat (validation)': {
        'amendments': ('Avenants et ordres de service', 'Avenants et OS (champ nature) : objet, date d\'effet, impacts, pièce, état de validation.'),
        'renewals': ('Reconductions', 'Reconductions : durée, nouvelle fin, pièce, état de validation.'),
        'terminations': ('Résiliations', 'Résiliations : motif, date d\'effet, pièce, état de validation.'),
        'trusteeChanges': ('Changements de syndic', 'Ancien et nouveau syndic, date d\'effet, pièce, état de validation.'),
        'beChanges': ('Changements de BE', 'Bureau d\'études désigné, contact, pièce, état de validation.'),
    },
    'Facturation': {
        'invoices': ('Factures', 'Factures émises par le moteur de facturation : numéro, période, montants, statut d\'encaissement.'),
        'invoices · lignes': ('Lignes de facture', 'Détail des lignes de chaque facture (site, activité, période, montant, TVA) et analytique figée à l\'émission (code, axes).'),
    },
    'Administration': {
        'users': ('Utilisateurs', 'Comptes de l\'application : rôle, modules, périmètre.'),
        'roles': ('Rôles', 'Rôles et droits (administrateur, contrathèque).'),
        'imports': ('Journal des imports', 'Imports réalisés (ici : la constitution du jeu de démo).'),
        '(stockage)': ('Fichiers (stockage)', 'Pièces PDF déposées (contrats signés, avenants, OS…).'),
    },
}

# Colonnes d'identification placées en tête.
EN_TETE = ['id', 'code', 'externalCode', 'contractNumber', 'invoiceNumber', 'name', 'label', 'clientName', 'contractId', 'siteId', 'clientId']
MONTANT = re.compile(r'(price|amount|total|subtotal|tax|impactP|baseAmount|montant|base)', re.I)
JOUR = re.compile(r'^\d{4}-\d{2}-\d{2}$')
INSTANT = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')

POLICE = 'Arial'
F_TITRE = Font(name=POLICE, size=14, bold=True, color='1F3864')
F_EN_TETE = Font(name=POLICE, size=10, bold=True, color='FFFFFF')
F_NORMAL = Font(name=POLICE, size=10)
F_GROUPE = Font(name=POLICE, size=10, bold=True, color='1F3864')
F_LIEN = Font(name=POLICE, size=10, color='0563C1', underline='single')
F_NOTE = Font(name=POLICE, size=9, italic=True, color='595959')
FOND_EN_TETE = PatternFill('solid', fgColor='1F3864')
FOND_GROUPE = PatternFill('solid', fgColor='D9E1F2')
BORD = Border(bottom=Side(style='thin', color='BFBFBF'))


def valeur(v):
    """Cellule JSON → valeur Excel (dates réelles, le reste tel quel)."""
    if isinstance(v, str):
        if JOUR.match(v):
            return date.fromisoformat(v)
        if INSTANT.match(v):
            try:
                return datetime.fromisoformat(v.replace('Z', '+00:00')).replace(tzinfo=None)
            except ValueError:
                return v
    return v


def onglet(wb, nom, colonnes, lignes):
    ws = wb.create_sheet(nom[:31])
    ordre = [c for c in EN_TETE if c in colonnes] + [c for c in colonnes if c not in EN_TETE]
    idx = [colonnes.index(c) for c in ordre]
    ws.append(ordre)
    for cell in ws[1]:
        cell.font, cell.fill = F_EN_TETE, FOND_EN_TETE
        cell.alignment = Alignment(vertical='center')
    largeurs = [len(c) + 2 for c in ordre]
    for ligne in lignes:
        ws.append([valeur(ligne[i]) for i in idx])
        for j, cell in enumerate(ws[ws.max_row]):
            cell.font = F_NORMAL
            v = cell.value
            if isinstance(v, datetime):
                cell.number_format = 'dd/mm/yyyy hh:mm'
                n = 16
            elif isinstance(v, date):
                cell.number_format = 'dd/mm/yyyy'
                n = 10
            elif isinstance(v, (int, float)) and not isinstance(v, bool) and MONTANT.search(ordre[j]) and 'rate' not in ordre[j].lower():
                cell.number_format = '#,##0.00'
                n = 12
            else:
                n = len(str(v)) if v is not None else 0
            largeurs[j] = max(largeurs[j], min(n + 2, 60))
    for j, l in enumerate(largeurs, start=1):
        ws.column_dimensions[get_column_letter(j)].width = max(8, l)
    ws.freeze_panes = 'B2'
    if ws.max_row > 1:
        ws.auto_filter.ref = ws.dimensions
    return ws


F_ENTREE = Font(name=POLICE, size=10, color='0000FF')
F_GRAS = Font(name=POLICE, size=10, bold=True)
FOND_RESULTAT = PatternFill('solid', fgColor='E2EFDA')


def onglet_interessement(wb, cas):
    """Calcul d'intéressement attendu, par des formules du classeur (indépendantes de l'application)."""
    ws = wb.create_sheet('Intéressement (calcul)', 1)
    ws['A1'] = 'Intéressement attendu — saison du 01/10/2025 au 31/05/2026'
    ws['A1'].font = F_TITRE
    ws['A2'] = ("Valeurs d'entrée en bleu (paramétrage P1, relevés, DJU de la démo) ; le reste est calculé par les formules de "
                "cette feuille. Comparez le montant à celui de l'écran « Gérer l'intéressement » de la prestation P1 du site "
                "(dates du 01/10/2025 au 31/05/2026, relevés du 30/09/2025 et du 31/05/2026).")
    ws['A2'].font = F_NOTE
    ws['A2'].alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells('A2:F2')
    ws.row_dimensions[2].height = 40
    r = 4
    for c in cas:
        ws.cell(r, 1, f"{c['site']} ({c['codeSite']}) — compteur {c['compteur']} — marché {c['marche']} — station {c['station']}").font = F_GROUPE
        for col in range(1, 7):
            ws.cell(r, col).fill = FOND_GROUPE
        r += 1
        ref = {}
        entrees = [
            ('debut', f"Index début (relevé du {c['releveDebut'][8:]}/{c['releveDebut'][5:7]}/{c['releveDebut'][:4]})", c['indexDebut'], '#,##0.0', 'Relevé du compteur'),
            ('fin', f"Index fin (relevé du {c['releveFin'][8:]}/{c['releveFin'][5:7]}/{c['releveFin'][:4]})", c['indexFin'], '#,##0.0', 'Relevé du compteur'),
            ('qe', 'Coefficient de conversion QE (MWh / unité)', c['qe'], '0.0000', 'Paramétrage P1 du compteur'),
            ('nb', 'Cible NB (MWh)', c['cibleNb'], '#,##0.00', 'Paramétrage P1 du poste de consommation'),
            ('djuref', 'DJU de référence', c['djuReference'], '#,##0.0', 'Paramétrage P1 du poste de consommation'),
            ('djumes', 'DJU mesurés sur la période', c['djuMesures'], '#,##0.0', f"Somme des DJU journaliers de la station {c['station']}"),
            ('pu', "Prix unitaire de l'intéressement (€/MWh)", c['prixUnitaire'], '#,##0.00', 'Prestation P1 (PU intéressement)'),
            ('marche', 'Type de marché', c['marche'], '@', 'Paramétrage P1 du site'),
        ]
        for cle, lib, val, fmt, src in entrees:
            ws.cell(r, 1, lib).font = F_NORMAL
            cell = ws.cell(r, 2, val)
            cell.font, cell.number_format = F_ENTREE, fmt
            ws.cell(r, 3, src).font = F_NOTE
            ref[cle] = f'$B${r}'
            r += 1
        # Lignes de calcul (formules), puis tranches du barème.
        r += 1
        calc_debut = r
        lignes = [
            ('nc', 'NC : consommation (MWh)', f"=({ref['fin']}-{ref['debut']})*{ref['qe']}", '#,##0.000', '(index fin − index début) × QE'),
            ('nprime', "N'B : cible corrigée des DJU (MWh)", f"={ref['nb']}*{ref['djumes']}/{ref['djuref']}", '#,##0.000', 'NB × DJU mesurés / DJU de référence'),
            ('ecart', "Écart N'B − NC (MWh)", None, '#,##0.000', '> 0 : économie ; < 0 : dépassement'),
            ('sens', 'Sens', None, '@', ''),
            ('client', 'Part du client (MWh)', None, '#,##0.000', 'Somme des tranches du barème ci-dessous'),
            ('quantite', 'Quantité régularisée (MWh)', None, '#,##0.000', 'MTI : économie → −part client, dépassement → +part client ; MCI : économie → écart − part client, dépassement → −(|écart| − part client)'),
            ('montant', "Montant de l'intéressement (€ HT)", None, '#,##0.00', 'Quantité × prix unitaire ; > 0 : facturé au client, < 0 : avoir'),
        ]
        pos = {cle: calc_debut + i for i, (cle, *_rest) in enumerate(lignes)}
        R = lambda k: f'$B${pos[k]}'
        t0 = calc_debut + len(lignes) + 2   # première ligne des tranches
        nt = max(1, len(c['tranches']))
        formules = {
            'ecart': f"={R('nprime')}-{R('nc')}",
            'sens': f'=IF({R("ecart")}>=0,"economie","depassement")',
            'client': f'=SUM($F${t0}:$F${t0 + nt - 1})',
            'quantite': f'=IF({ref["marche"]}="MTI",IF({R("ecart")}>=0,-{R("client")},{R("client")}),IF({R("ecart")}>=0,{R("ecart")}-{R("client")},-(ABS({R("ecart")})-{R("client")})))',
            'montant': f"={R('quantite')}*{ref['pu']}",
        }
        for cle, lib, f, fmt, aide in lignes:
            ws.cell(r, 1, lib).font = F_GRAS if cle == 'montant' else F_NORMAL
            cell = ws.cell(r, 2, f or formules[cle])
            cell.font, cell.number_format = (F_GRAS if cle == 'montant' else F_NORMAL), fmt
            if cle == 'montant':
                cell.fill = FOND_RESULTAT
            ws.cell(r, 3, aide).font = F_NOTE
            r += 1
        r += 1
        for col, titre in enumerate(['Barème : sens', 'Borne basse', 'Borne haute', 'Part du client', 'Quantité de la tranche (MWh)', 'Part du client (MWh)'], start=1):
            cell = ws.cell(r, col, titre)
            cell.font, cell.fill = F_EN_TETE, FOND_EN_TETE
        r += 1
        assert r == t0
        for t in c['tranches'] or [{'sens': '', 'borneBasse': 0, 'borneHaute': 0, 'partClient': 0}]:
            for col, (v, fmt) in enumerate([(t['sens'], '@'), (t['borneBasse'], '0%'), (t['borneHaute'], '0%'), (t['partClient'], '0%')], start=1):
                cell = ws.cell(r, col, v)
                cell.font, cell.number_format = F_ENTREE, fmt
            ws.cell(r, 5, f'=IF($A{r}={R("sens")},MAX(0,MIN(ABS({R("ecart")}),$C{r}*{R("nprime")})-$B{r}*{R("nprime")}),0)').number_format = '#,##0.000'
            ws.cell(r, 6, f'=E{r}*D{r}').number_format = '#,##0.000'
            for col in (5, 6):
                ws.cell(r, col).font = F_NORMAL
            r += 1
        if c.get('application'):
            r += 1
            ws.cell(r, 1, "Montant calculé par l'application (bibliothèque de calcul), pour comparaison").font = F_NOTE
            cell = ws.cell(r, 2, round(c['application']['montant'], 2))
            cell.font, cell.number_format = F_ENTREE, '#,##0.00'
            ws.cell(r, 3, f"=IF(ABS({R('montant')}-B{r})<0.01,\"identique\",\"différent : \"&TEXT({R('montant')}-B{r},\"0.00\"))").font = F_GRAS
            r += 1
        r += 2
    for col, l in zip('ABCDEF', (52, 16, 70, 14, 26, 20)):
        ws.column_dimensions[col].width = l
    return ws


def main():
    data = json.load(open(SOURCE, encoding='utf-8'))
    tables = data['tables']

    # Lignes de facture : une ligne par élément de facture.
    if 'invoices' in tables:
        inv = tables['invoices']
        ci = {c: i for i, c in enumerate(inv['colonnes'])}
        cols, lignes = None, []
        for l in inv['lignes']:
            for item in json.loads(l[ci['lineItems']] or '[]'):
                ent = {'invoiceId': l[ci['id']], 'invoiceNumber': l[ci['invoiceNumber']] if 'invoiceNumber' in ci else None, **item}
                cols = cols or list(ent.keys())
                cols += [k for k in ent if k not in cols]
                lignes.append(ent)
        if cols:
            tables['invoices · lignes'] = {'colonnes': cols, 'lignes': [[e.get(c) if not isinstance(e.get(c), (dict, list)) else json.dumps(e.get(c), ensure_ascii=False) for c in cols] for e in lignes]}

    wb = Workbook()
    som = wb.active
    som.title = 'Sommaire'
    som['A1'] = 'Extraction des tables Zenergya — données simulées'
    som['A1'].font = F_TITRE
    som['A2'] = (f"Jeu de démonstration fictif (aucune donnée réelle), projet {data['projet']}, extrait le "
                 f"{datetime.fromisoformat(data['extraitLe'].replace('Z', '+00:00')).strftime('%d/%m/%Y à %H:%M')} (UTC). "
                 'Un onglet par composant : une ligne par enregistrement, une colonne par champ (objets imbriqués en « parent.enfant », listes en JSON).')
    som['A2'].font = F_NOTE
    som['A2'].alignment = Alignment(wrap_text=True, vertical='top')
    som.merge_cells('A2:E2')
    som.row_dimensions[2].height = 42
    som.append([])
    som.append(['Composant', 'Onglet (collection)', 'Rôle', 'Lignes', 'Colonnes'])
    for cell in som[4]:
        cell.font, cell.fill = F_EN_TETE, FOND_EN_TETE

    vus = set()
    for groupe, comps in list(COMPOSANTS.items()) + [('Autres', {})]:
        presents = [(k, v) for k, v in comps.items() if k in tables]
        if groupe == 'Autres':
            presents = [(k, (k, '')) for k in sorted(tables) if k not in vus]
        if not presents:
            continue
        som.append([groupe])
        r = som.max_row
        for c in range(1, 6):
            som.cell(r, c).fill = FOND_GROUPE
        som.cell(r, 1).font = F_GROUPE
        for nom, (libelle, role) in presents:
            vus.add(nom)
            t = tables[nom]
            ws = onglet(wb, nom, t['colonnes'], t['lignes'])
            feuille = ws.title.replace("'", "''")
            som.append([libelle, ws.title, role, f"=COUNTA('{feuille}'!A:A)-1", len(t['colonnes'])])
            r = som.max_row
            lien = som.cell(r, 2)
            lien.hyperlink = f"#'{feuille}'!A1"
            for c in range(1, 6):
                som.cell(r, c).font = F_NORMAL
                som.cell(r, c).border = BORD
                som.cell(r, c).alignment = Alignment(vertical='top', wrap_text=(c == 3))
            lien.font = F_LIEN
    for col, l in zip('ABCDE', (30, 24, 80, 9, 10)):
        som.column_dimensions[col].width = l
    som.freeze_panes = 'A5'
    if data.get('interessements'):
        ws = onglet_interessement(wb, data['interessements'])
        som.append([])
        som.append(['Intéressement (calcul)', ws.title, "Calcul attendu de l'intéressement de la saison 2025-2026, par des formules du classeur, à comparer à l'écran de l'application.", len(data['interessements']), None])
        r = som.max_row
        som.cell(r, 2).hyperlink = f"#'{ws.title}'!A1"
        for c in range(1, 6):
            som.cell(r, c).font = F_NORMAL
        som.cell(r, 2).font = F_LIEN
    wb.calculation.fullCalcOnLoad = True
    wb.save(SORTIE)
    print(f'{len(wb.sheetnames) - 1} onglets → {SORTIE}')


if __name__ == '__main__':
    main()
