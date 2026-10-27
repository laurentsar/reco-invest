# Reco Invest

Application Android (Capacitor) + PWA de **recommandations d'investissement**, dérivée
du magazine **Le Revenu** (source du dashboard Flux RSS).

> ⚠️ **Informations à but éducatif — aucun conseil en investissement.** Les signaux sont
> générés automatiquement ; les performances passées ne préjugent pas des performances futures.

## Ce que fait l'app

- **🎯 Signaux valeurs** — pour chaque société citée dans l'édition du Revenu, une reco
  (`ACHETER` → `VENDRE`) combinant :
  - **Sentiment presse** (analyse lexicale des titres/chapôs du flux RSS Le Revenu),
  - **Analyse technique** sur cours réels (Yahoo Finance) : **SMA 20/50/200**, **RSI 14**,
    **MACD 12-26-9**, **momentum 3 mois**, **volatilité**.
  - **Bougies japonaises** (OHLC Yahoo, 3 dernières séances, 15 % du verdict) : englobante haussière/baissière,
    ligne de pénétration, couverture en nuage noir, marteau, marteau inversé, homme pendu,
    étoile filante, doji libellule / pierre tombale, marubozu (+ doji/toupie = hésitation,
    neutres). Les figures de retournement ne comptent que dans leur contexte de tendance,
    à pleine force si confirmées par la séance suivante, ignorées si leur stop est cassé ;
    la carte affiche la figure + un **stop suggéré** (plus bas/haut de la figure).
  - Pondération : 60 % technique + 40 % presse.
- **🧭 Thématiques** — tendance par classe d'actifs (SCPI, ETF, assurance-vie, or, taux,
  défense, IA…) selon le ton des articles.
- **💼 Portefeuille + alertes de revente semi-auto** — saisie manuelle des positions ;
  règles configurables : **stop-loss %**, **take-profit %**, **objectif de cours**, **RSI de surachat**.
  Une **figure de bougie baissière** sur une position détenue déclenche aussi une alerte « Alléger ».
  L'app surveille les cours et **alerte** quand une règle se déclenche (notification).
  L'**exécution reste manuelle** chez le courtier.
- **📊 Allocation** — répartition cible indicative par profil (Prudent / Équilibré / Dynamique).
- **📖 Magazine** — lanceur du magazine Le Revenu sur Cafeyn + liens lerevenu.com.

## Pourquoi pas de trading automatique ?

Ni **Boursorama** ni **Trade Republic** n'exposent d'API officielle de passage d'ordres.
La DSP2 n'ouvre que la consultation de comptes, pas l'exécution. Automatiser l'exécution
imposerait une API non-officielle (fragile, hors CGU, risquée sur de l'argent réel) ou un
courtier à API dédiée (Interactive Brokers, Saxo…). L'app s'arrête donc à la **décision +
alerte** ; tu passes l'ordre toi-même.

## Données

- **Le Revenu** : `https://www.lerevenu.com/rss.xml` (repli proxy CORS pour la PWA ; fetch natif dans l'APK).
- **Cours** : Yahoo Finance `chart` API (mêmes replis). 100 % côté client, cache `localStorage`.

## Build

APK construit par **GitHub Actions** (`.github/workflows/build-apk.yml`) au push sur `master`,
signé (`android/app/recoinvest.p12`), publié en **Release GitHub** avec bannière de mise à jour
en app (`www/update-check.js`). Build local impossible sur la cible ARM64/1 Go.

Bump de version : `android/app/build.gradle` (`versionName` + `versionCode`) — la CI
synchronise `APP_VERSION` dans `www/app.js`.
