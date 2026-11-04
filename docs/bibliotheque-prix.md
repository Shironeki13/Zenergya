# Bibliothèque de prix

Menu **Travaux → Bibliothèque de prix**. Articles et ouvrages réutilisables dans les devis (bouton **Bibliothèque**
de l'éditeur de devis).

## Articles

Fourniture, main-d'œuvre, sous-traitance ou divers : code (vide = attribué, `ART-00001`), libellé, unité,
**déboursé HT** (coût), famille, fournisseur et sa référence, description (reprise sur le devis). Un article de
main-d'œuvre sans déboursé prend le **coût horaire du devis**. Le prix de vente n'est pas stocké : il se calcule dans
chaque devis (coefficient, taux horaire). Un article se **désactive** (n'est plus proposé) ; il ne se supprime pas.

### Import et export CSV

Séparateur détecté (`;` ou `,`), nombres à la française ou à l'anglaise. Colonnes reconnues :

| Colonne | Obligatoire | En-têtes acceptés |
| --- | --- | --- |
| Code | oui | code, référence, ref |
| Libellé | oui | libellé, désignation |
| Unité | oui | unité |
| Déboursé | oui sauf main-d'œuvre | déboursé, coût, prix d'achat, prix, PU HT |
| Nature | non (fourniture) | nature, type : fourniture, main-d'œuvre / MO, sous-traitance / ST, divers |
| Famille, fournisseur, réf. fournisseur, description | non | |

Avant d'importer : nombre d'articles créés, mis à jour (par **code**) — avec les changements de déboursé — et
inchangés, et les lignes ignorées avec leur motif. Une colonne facultative vide **conserve** la valeur existante :
l'import est rejouable. L'export produit le même format.

## Ouvrages

Un ouvrage regroupe des articles et leurs quantités **pour une unité** (ex. « Pose d'un radiateur » = 1 radiateur +
1 kit + 2 h de main-d'œuvre). Code `OUV-00001` par défaut.

Dans un devis, un ouvrage est **une seule ligne pour le client** ; sa composition reste interne (▸ dans l'éditeur,
modifiable sur le brouillon). Son prix unitaire est la somme de ses composants, chacun chiffré selon sa nature et
les conditions du devis : fournitures, sous-traitance et divers au déboursé × coefficient (celui de la ligne
s'il est saisi), main-d'œuvre au taux horaire. Un prix imposé reste possible.

## Recopie

Articles et ouvrages sont **recopiés** dans le devis (avec leur code pour mémoire) : modifier ou désactiver un
élément de la bibliothèque ne change jamais un devis existant.
