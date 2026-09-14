# Météo-France — la clé qui débloque 1 954 stations, et pourquoi elle est réservée à l'hébergé

Statut au **14 septembre 2026** : **à contractualiser, rien n'est engagé.** Le
dépôt open source reste sans clé et le restera ; ce document décrit ce que la
version hébergée de GEV gagnerait à en obtenir une, et ce qu'il faut vérifier
avant de signer.

## Le manque, mesuré

La couche `meteo-stations-fr` dessine **190 stations** depuis le
[`SHOW_ONLY_PUBLISHING`](../src/data/meteoStationsFrance.js) posé le 14 septembre
2026. Le réseau temps réel de Météo-France en compte **2 144**. L'écart n'est
pas un choix de carte, c'est un mur :

| | stations | ce qu'un lecteur obtient |
|---|---|---|
| Publient en accès libre (archive SYNOP) | **190** | un relevé, daté, sans clé |
| Mesurent sans publier | **1 954** | rien — la mesure existe, elle est derrière la clé |

Et sur les 190, la fraîcheur est bornée par le produit lui-même. L'archive
annuelle `synop_2026.csv.gz` est une **consolidation quotidienne d'observations
tri-horaires** : 382 344 lignes pour 190 stations sur 251 jours, soit exactement
8 relevés par station et par jour, écrites en un seul passage vers 07:00 UTC et
s'arrêtant à la veille 21:00 UTC. Donc **le relevé le plus frais accessible sans
clé a entre 11 et 35 heures.** Aucun réglage de cache ne peut améliorer ce
chiffre.

C'est la vraie raison d'être de cette page : la clé n'achète pas seulement des
stations en plus, elle achète **l'heure qui vient de passer**.

## Ce que la clé ouvre — vérifié, pas supposé

`public-api.meteofrance.fr` distingue 401 (le chemin existe, il manque la clé) de
404 (le chemin n'existe pas). Sondé le 2026-09-14 sans clé :

| Endpoint | Réponse | Ce qu'il donne |
|---|---|---|
| `public/DPObs/v1/liste-stations` | **401** | la liste du réseau d'observation, côté API |
| `public/DPObs/v1/station/horaire` | **401** | le relevé horaire d'UNE station |
| `public/DPPaquetObs/v1/paquet/horaire` | **401** | le relevé horaire de TOUT un département en un appel |
| `public/DPClim/v1/liste-stations/horaire` | **401** | le climatologique horaire |
| `public/nope/v1/x` (témoin) | 404 | — |

`DPPaquetObs` est celui qui compte : un appel par département donne la France
entière en ~101 requêtes horaires, ce que le proxy actuel fait déjà en une seule
lecture de 23 Mo. L'ordre de grandeur est tenable.

## Ce qu'il reste à vérifier avant de signer

Trois points, et aucun n'est tranché ici :

1. **Le palier.** `METEOFRANCE_API_KEY` est déjà déclaré `tier: 'free'` dans
   `src/keySetupCore.mjs` — pour la vigilance (DPVigilance), obtenue avec un
   simple compte. Il faut confirmer que DPObs et DPPaquetObs sont dans le même
   palier gratuit ou dire combien coûte le palier au-dessus.
2. **Le droit de rediffusion publique.** Le point bloquant réel. Les données
   sont sous Licence Ouverte 2.0 côté open data ; les conditions du portail API
   peuvent encadrer la **rediffusion à des tiers**, ce qui est exactement ce
   que fait un globe public. À lire dans les CGU avant d'afficher un seul
   relevé.
3. **Le quota.** 60 req/min sur DPVigilance ; à confirmer sur DPObs, et à
   confronter au plafond de dépense global (`docs/DEPLOY.md`).

## Où ça se branche — le travail est déjà fait

Rien à construire côté architecture, la porte est posée :

- `METEOFRANCE_API_KEY` **existe déjà** (`.env.example`, `setup-doctor`,
  `keySetupCore.mjs`) et sert déjà de clé serveur pour `/api/vigilance`, en
  en-tête `apikey:`. Même variable, même mécanique.
- `SHOW_ONLY_PUBLISHING` dans `src/data/meteoStationsFrance.js` est **un
  booléen**. Le pack expédié porte toujours les 2 144 stations — 660 Ko contre
  72 Ko, payés une fois, seulement quand la couche est allumée — précisément
  pour que ce basculement ne demande aucune reconstruction de données.
- Le proxy `/api/meteo-stations/observations` a déjà la forme attendue : une
  observation par station, indexée sur l'indicatif OMM. Une source de plus à
  préférer quand la clé est là, exactement comme la vigilance préfère l'API
  contractée et garde le miroir en repli.

Estimation : **une demi-journée de code** une fois la clé en main (source
alternative dans le proxy, bascule du booléen conditionnée à la présence de la
clé, une ligne de crédit). Le reste est administratif.

## La règle : hébergé seulement, et jamais au détriment du sans-clé

GEV open source **doit démarrer et tout dessiner sans une seule clé**. Donc :

- Le défaut du dépôt reste `SHOW_ONLY_PUBLISHING = true`, 190 stations, zéro
  credential. Un clone sans `.env` voit exactement ce que voit le dépôt.
- La clé n'est jamais un prérequis : elle **ajoute** 1 954 stations et de la
  fraîcheur, elle n'en retire aucune.
- Aucune donnée Météo-France sous clé ne doit être présentée comme une donnée
  du projet : le crédit dit d'où elle vient et sous quelle licence, comme pour
  toutes les autres.
- Ce que la version hébergée affiche en plus doit rester **visiblement** ce
  qu'il est — un réseau plus dense et des relevés plus frais — et pas une
  fonctionnalité cachée derrière un compte.

## Voisins

- `docs/candhis-access.md` — même forme de blocage (une clé, une demande), sur
  l'état de la mer.
- Trap 6 dans `src/data/meteoStationsFrFeed.js` — le miroir gelé du 2026-09-09
  et la cadence réelle du produit, mesurés.
