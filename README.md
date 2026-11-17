# À deux

Application de couple pour organiser le quotidien et répartir la charge mentale.
PWA en français, pensée pour le téléphone, utilisée à deux depuis deux comptes.

Stack : Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Auth, Postgres, Realtime).
Fuseau par défaut : Europe/Paris.

## Ce que fait la V1

- **Planning** : Aujourd’hui (récupération du jour en haut, rendez-vous, mes tâches, retards, suivis à relancer, réponses attendues, demain, listes favorites) et Semaine (lundi → dimanche).
- **Organiser les récupérations** : un seul écran pour la semaine, heure et responsable par jour (Moi / prénom / À décider), « Pas de crèche », jours habituels et heure par défaut. Celui qui organise la semaine voit les jours non couverts dans ses suivis.
- **Je la récupère** (le premier enregistrement l’emporte), **relais** (demander, accepter, refuser, annuler ; le nom ne change qu’à l’acceptation).
- **Sujets partagés** : saisie avec le seul titre, « À prendre en charge », passation (le responsable reste jusqu’à l’acceptation), prochaine étape datée qui remonte dans l’accueil du responsable, clôture.
- **Tâches et rendez-vous**, **listes partagées** (favoris, quantités), **idées cadeaux** (destinataire, occasion, note ou lien, statut, filtres).
- **Pour moi** : tâches perso, objectifs, listes privées (dont « Mes surprises »), invisibles pour le partenaire.
- **Synchronisation temps réel** entre les deux comptes.

Les notifications push ne sont pas dans la V1 : les rappels et demandes de relais s’affichent dans l’application.

## Lancer le projet

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Appliquer la migration `supabase/migrations/20261117000000_init.sql`, au choix :
   - `npx supabase link --project-ref <ref>` puis `npx supabase db push` ;
   - ou copier le fichier dans l’éditeur SQL du tableau de bord et l’exécuter.
3. Dans Supabase :
   - **Authentication > Providers > Email** : activé. Pour tester vite, désactiver « Confirm email » ; sinon chaque compte confirme son adresse.
   - **Authentication > URL Configuration** : ajouter l’URL de l’app (ex. `http://localhost:3000`) aux redirections autorisées.
   - **Database > Publications** : la migration ajoute les tables à `supabase_realtime`, vérifier qu’elles y figurent.
4. `cp .env.example .env.local` et renseigner l’URL et la clé `anon` du projet.
5. `npm install` puis `npm run dev`, ouvrir http://localhost:3000.

## Tester à deux

1. Dans un premier navigateur, créer un compte, puis « Créer l’espace » avec son prénom.
2. Avatar en haut à droite > **Réglages** > « Créer un lien d’invitation » (usage unique, 7 jours).
3. Ouvrir ce lien dans un second navigateur (ou en navigation privée), créer le second compte et rejoindre l’espace.
4. Le prénom de l’enfant (Juliette par défaut, donnée de démonstration), le pronom du bouton et le libellé « Récupération crèche » se changent dans les Réglages.

## Vérifications

```bash
npm run lint && npm run typecheck && npm test   # lint, types, logique de l’accueil
npm run build
```

**RLS et fonctions serveur** (Postgres local, sans Supabase) :

```bash
PGHOST=… PGPORT=… npm run test:sql
```

`supabase/tests/01_scenarios.sql` rejoue les parcours avec trois comptes (Hugo, Camille, une inconnue) sous le rôle `authenticated` : invitation à usage unique, semaine de crèche, prise simultanée, relais, sujet « Banque », passation, listes, surprise privée inaccessible en lecture comme en écriture.

**Parcours de bout en bout** (deux navigateurs iPhone, Playwright) :

```bash
DB=$(PGHOST=… PGPORT=… ./e2e/setup-db.sh)
DATABASE_URL="postgres://postgres@/$DB?host=…&port=…" node e2e/mock-supabase.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key npm run build && npm start &
npm run e2e        # captures dans e2e/captures
```

`e2e/mock-supabase.mjs` est un **banc d’essai**, pas Supabase : il imite l’API (Auth, PostgREST, Realtime) au-dessus d’un vrai Postgres où la migration et la RLS s’appliquent. Le même script `e2e/two-accounts.cjs` peut viser un vrai projet Supabase via `APP_URL`, `API_URL` et `ANON_KEY` (désactiver alors la confirmation d’e-mail).

## Sécurité des données

- Toutes les tables ont la RLS activée : seuls les deux membres du couple lisent les données partagées ; tâches, listes et objectifs privés ne sont lisibles et modifiables que par leur propriétaire.
- Les récupérations et relais ne s’écrivent que via des fonctions serveur (`claim_pickup`, `request_relay`, `respond_relay`, `cancel_relay`, `save_pickups`) ; une contrainte unique garantit une seule récupération par jour.
- Le responsable d’un sujet ne change que via `claim_topic` / `propose_topic` / `respond_topic` ; seul le responsable fixe la prochaine étape.
- L’invitation (`create_invite`, `accept_invite`) limite l’espace à deux membres.
