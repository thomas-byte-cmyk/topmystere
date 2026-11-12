# 🏆 TopMystère

Jeu quotidien de pop culture, entre *Wordle* et *Une famille en or* : chaque jour, un classement mystère (Top 3, 5 ou 10) à compléter avec **3 vies**.

## Fonctionnalités

- Un classement par jour, le même pour tout le monde (rotation automatique dans `puzzles.json`).
- Style « plateau TV » : panneaux bleus qui se retournent en 3D, cadre doré avec ampoules, buzzer rouge.
- Pas de vies : on peut se tromper autant qu'on veut, mais les erreurs sont comptées et apparaissent dans le score.
- Joker 💡 (gratuit) : révèle la 1re lettre (le reste est masqué) et un indice de la meilleure place encore cachée.
- Bouton « Abandonner » (avec confirmation) pour découvrir tout le classement.
- Top 10 en mode compact pour voir un maximum de lignes sur un téléphone.
- Validation tolérante : majuscules, accents, ponctuation, espaces, articles (« le », « the »…), alias, et 1 à 2 fautes de frappe (sans confondre « Iron Man 2 » et « Iron Man 3 »).
- Sauvegarde locale (`localStorage`) : partie en cours, statistiques, série de victoires, historique.
- Modale de fin : stats, classement complet, bouton « Partager mon score » (texte à émojis copié dans le presse-papiers).
- Mode archives (icône dans l'en-tête) pour rejouer toutes les énigmes. Ces parties ne comptent pas dans les stats.

## Structure

```
topmystere/
├── index.html     → structure de la page et des modales
├── style.css      → design (mode sombre, mobile-first, animations)
├── app.js         → toute la logique du jeu (commentée)
├── puzzles.json   → les énigmes
└── README.md
```

## Lancer le jeu sur ton ordinateur

⚠️ Un double-clic sur `index.html` ne suffit pas : le navigateur bloque la lecture de `puzzles.json` quand la page est ouverte comme un fichier. Il faut un petit serveur local (une seule commande) :

1. Ouvre un terminal (Mac : application **Terminal**, Windows : **PowerShell**).
2. Va dans le dossier du projet, par exemple :
   ```bash
   cd chemin/vers/topmystere
   ```
3. Lance le serveur (Python est souvent déjà installé) :
   ```bash
   python3 -m http.server 8000
   ```
   Sous Windows, si `python3` n'existe pas, utilise `python -m http.server 8000`.
4. Ouvre **http://localhost:8000** dans ton navigateur.
5. Pour arrêter le serveur, reviens dans le terminal et tape `Ctrl + C`.

Autre solution : l'extension **Live Server** de VS Code (clic droit sur `index.html` → *Open with Live Server*).

### Astuces de test

- Ouvre la console du navigateur (`F12` → onglet *Console*).
- `TopMystere.resetAll()` efface toute la sauvegarde et recharge la page.
- Pour simuler un autre jour, modifie `LAUNCH_DATE` en haut de `app.js`.

## Ajouter ou modifier une énigme

Dans `puzzles.json`, ajoute un objet dans la liste `puzzles` :

```json
{
  "id": "identifiant-unique",
  "category": "Jeux vidéo",
  "emoji": "🎮",
  "title": "Les 3 …",
  "source": "Source (année)",
  "items": [
    { "rank": 1, "answer": "Nom affiché", "aliases": ["autre nom", "abréviation"], "value": "100 millions", "hint": "Un court indice" }
  ]
}
```

- Le nombre d'`items` (3, 5 ou 10) définit le type de Top.
- Inutile de mettre des variantes d'accents ou de majuscules dans `aliases` : elles sont déjà gérées automatiquement.
- L'ordre des énigmes dans le fichier = l'ordre des jours.

> ⚠️ **Données à vérifier avant le lancement public** : les chiffres viennent de sources publiques (2025) et certains bougent (vues YouTube, abonnés Instagram, box-office). Les plus fragiles : la 5e place des jeux vidéo (Red Dead Redemption 2, au coude-à-coude avec Mario Kart 8 et PUBG), la 3e vidéo YouTube et le Top 10 box-office (Zootopie 2 et Avatar 3 sont sortis fin 2025).

## Mettre le jeu en ligne gratuitement (GitHub Pages)

Une fois le code sur GitHub :

1. Sur la page du dépôt, clique sur **Settings** (onglet en haut à droite).
2. Dans le menu de gauche, clique sur **Pages**.
3. Dans **Build and deployment** → **Source**, choisis **Deploy from a branch**.
4. Dans **Branch**, choisis `main` et le dossier `/ (root)`, puis **Save**.
5. Attends 1 à 2 minutes et recharge la page : l'adresse du jeu s'affiche, du type `https://ton-pseudo.github.io/topmystere/`.

Chaque nouvelle modification envoyée sur `main` met le site à jour automatiquement.

## Pistes pour la suite

- Ajouter des énigmes (une par jour = 365 pour un an).
- Un nom de domaine personnalisé.
- Un backend (ex. Supabase) pour des statistiques mondiales (« 38 % des joueurs ont trouvé le n°1 »).
- PWA (installable sur l'écran d'accueil du téléphone).
