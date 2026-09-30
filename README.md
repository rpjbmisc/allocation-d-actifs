# Allocation d'actifs

Interface locale d'analyse historique multi-actifs.

## Lancer l'application

```bash
npm install
npm run dev
```

Puis ouvrir l'URL affichée par Vite, généralement `http://localhost:5173`.

## Contenu

- `src/` : application React, calculs statistiques et simulation de portefeuille.
- `public/data/` : registre et séries CSV utilisées par l'interface.
- `MultiAssetComparison.tsx` : version Dust originale conservée comme référence.
- `Bourse/`, `Immobilier/`, `SCPI/`, `Suivi_Epargne.xlsx` : documents personnels conservés localement et exclus du dépôt Git.

Le tableau de bord charge les actifs déclarés dans `public/data/assets_index.json`. Les fichiers CSV enrichis sont conservés dans le corpus, mais ne sont pas affichés tant qu'ils ne sont pas ajoutés au registre des actifs.

L'onglet `Portefeuille` permet de tester une allocation pondérée sur la période commune sélectionnée. Il affiche le TCAM, la volatilité, le drawdown maximal, un Sharpe brut, la trajectoire de 100 unités investies, les pires années, le drawdown année par année et les corrélations entre actifs. La simulation utilise les rendements annuels et un rééquilibrage annuel implicite.

L'onglet `Corrélations` affiche tout l'univers des actifs par défaut dans une matrice thermique, avec sélection indépendante, période personnalisable, corrélation moyenne des paires, actifs et paires les plus complémentaires ou redondants, ainsi qu'un diagramme des TCAM nominaux ou réels. Les corrélations sont calculées sur les rendements annuels et indiquent le nombre d'observations communes par paire.

L'onglet `Corrélations` de l'analyse principale utilise les actifs, la période et le mode sélectionnés dans cette analyse. La page `/correlations` propose le même module avec un picker, une période et un mode indépendants.

Le picker propose aussi des allocations candidates calculées sur l'ensemble des actifs disponibles : optimum historique pur et optimum sous drawdown maximal de 40 % sur trois fenêtres communes de 25 ans, allocation robuste basée sur le pire CAGR de ces fenêtres et scénario avec Bitcoin sur 2014–2025. Leurs pondérations sont conservées dans `public/data/candidate_presets.json` et ne sont pas recalculées au chargement. Une candidate charge ses actifs et ses pondérations, verrouille le picker d'actifs et laisse les pourcentages modifiables dans le panneau de construction. Le mode `À la carte` réactive la sélection individuelle.

## Contexte vault

- Casquette : `Second Cerveau/2 CASQUETTES/Investissement/Investissement.md`.
- Projet : `Second Cerveau/1 PROJETS/Création d’une allocation d’actifs et d’une stratégie d’investissement/`.
