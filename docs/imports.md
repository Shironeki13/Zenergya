# Imports en masse

Menu **Imports** (administrateurs). Données importables : **clients et prospects**, **sites**, **contacts**,
**compteurs**. (Les articles de la bibliothèque de prix ont leur propre import : voir `bibliotheque-prix.md`.)

## Déroulé

1. Choisir le type de données et télécharger le **modèle** :
   - **CSV** (séparateur `;`, UTF-8 avec BOM, lisible tel quel par Excel) : en-têtes + une ligne d'exemple ;
   - **Excel** : onglet **Données** (en-têtes + exemple), onglet **Notice** (chaque colonne : obligatoire ou non,
     format, valeurs possibles, exemple, aide) et onglet **Listes** (valeurs du paramétrage : sociétés, agences,
     secteurs, typologies, types de compteur).
2. Remplir le fichier (supprimer la ligne d'exemple) et le **déposer** (CSV ou XLSX).
3. **Aperçu**, ligne par ligne : création, mise à jour, inchangé ou erreur (avec le motif). Rien n'est écrit.
   Erreurs téléchargeables en CSV.
4. **Importer** : les lignes valides sont écrites, les lignes en erreur ignorées et rapportées. Chaque import est
   tracé (collection `imports`, écrite par le serveur seulement) et listé dans « Derniers imports ».

## Règles communes

- Le fichier est **relu et contrôlé par le serveur** avant toute écriture (l'aperçu du navigateur n'est pas pris
  pour acquis).
- **Une cellule vide conserve la valeur existante** : un fichier peut ne contenir que les colonnes à mettre à jour,
  et un même fichier peut être réimporté (lignes « inchangé »).
- Une colonne obligatoire absente ne bloque pas le fichier : elle empêche seulement les **créations**.
- Les codes **CLI / SIT / CPT** sont attribués par Zenergya (au-delà du plus grand code existant) : un code saisi
  sert uniquement à retrouver un élément existant.
- En-têtes reconnus sans tenir compte des accents, majuscules et astérisques ; colonnes inconnues ignorées.
- Formats : nombres à la française ou à l'anglaise, oui / non, SIRET contrôlé (clé de Luhn), code postal à 5
  chiffres (le 0 initial retiré par Excel est rétabli), email.
- Doublons dans le fichier (même code, même SIRET, même client + n° de site…) : seule la première ligne est retenue.
- 10 000 lignes au plus par import.

## Correspondance (mise à jour plutôt que création)

| Données | Élément existant retrouvé par |
| --- | --- |
| Clients et prospects | code client (CLI-…), sinon SIRET |
| Sites | code site (SIT-…), sinon client + n° de site |
| Contacts | client + email, sinon client + nom |
| Compteurs | code compteur (CPT-…), sinon site + PDL/PCE |

Références vérifiées : société (code ou nom), agence **de cette société**, secteur **de cette agence**, typologie,
client (code ou SIRET), contrat (n° CTN, qui doit appartenir au client), site (code), type de compteur (code ou
libellé). Un site créé avec un contrat est ajouté aux sites du contrat.

## Fichiers Excel

La lecture des fichiers Excel exige une version corrigée de la librairie SheetJS (`xlsx` ≥ 0.19.3) : la 0.18.5
publiée sur npm a des failles à la lecture de fichiers fournis par l'utilisateur (CVE-2023-30533,
CVE-2024-22363). Avec une version non corrigée, le dépôt d'un fichier Excel est refusé (importer en CSV) ; les
modèles Excel restent téléchargeables. Version corrigée :
`npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

## À venir

Contrats et prestations ; vérification en masse des SIRET importés dans le répertoire des entreprises.
