# UGC NET Sanskrit (Code 25) Mock Test Website

Features: student sign-up/login, full 100-question mock (2 hrs, +2 per correct, no negative marking), 10 unit-wise tests, timer, question palette, mark-for-review, answer review with explanations, attempt history, leaderboard.

## Folder map
| Path | What it is |
|---|---|
| `public/` | The website (this is what gets published) |
| `public/config.js` | Your Supabase URL and key go here |
| `supabase/schema.sql` | Database setup (run once) |
| `sample_questions.csv` | Example question file (sample only, replace with your bank) |

## Setup, in order
1. **Supabase**: create a project (free). In *SQL Editor*, paste all of `supabase/schema.sql` and press Run.
2. **Keys**: Supabase > Project Settings > API. Copy the Project URL and the anon / publishable key into `public/config.js`.
3. **Sign-up emails**: Supabase > Authentication > Providers > Email. Turn "Confirm email" OFF if you want students to log in instantly. Leave it ON for verified emails (needs working email delivery).
4. **Rename units**: Supabase > Table Editor > `units`, change "Unit 1"... to the real syllabus unit names.
5. **Add questions**: Table Editor > `questions` > Insert > Import data from CSV, using the same columns as `sample_questions.csv`. `unit` is 1 to 10, `correct` is A, B, C or D.
6. **GitHub**: push this folder to a repository.
7. **Cloudflare Pages**: Workers & Pages > Create > Pages > Connect to Git. Build command: none. Output directory: `public`.
8. **Auth redirect**: Supabase > Authentication > URL Configuration, set Site URL to your `*.pages.dev` address.

## Rules built in
- Students can never read correct answers before submitting (enforced in the database).
- Marking happens on the server; the leaderboard ignores attempts over the time limit.
- To change time per question, edit both `MINUTES_PER_QUESTION` in `config.js` and the `72` (seconds) in `submit_attempt` in `schema.sql`.
- A full mock takes up to 10 questions from each unit, then fills the rest at random. A unit test uses up to 100 questions of that unit.

## Admin dashboard
Open `/admin.html` on your site (also linked as "Admin" in the top bar for admins). It lets you add, edit and delete questions, import a CSV of questions, rename units, and see students and recent attempts.

To make an account an admin, run this once in the Supabase SQL Editor (after `supabase/admin.sql` has been applied):

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'your-email@example.com'
on conflict do nothing;
```

## Practice and quality features
`supabase/features.sql` (run after `schema.sql` and `admin.sql`) adds: practice from your mistakes, saved questions, question reports, per-question accuracy for admins, and separate leaderboards that count only real full mocks and unit tests. Password reset emails need the Supabase Site URL set to your live address.

## Test of the Day
Run `supabase/daily.sql` (after the other SQL files). It adds one 20-question test per day (India time), identical for every student, one attempt each, with its own daily leaderboard ranked by score then speed.

## Upload batches (admin)
Run `supabase/batches.sql` (after `admin.sql`). Each CSV import is then saved as an upload; the admin **Uploads** tab lists them and can delete a whole upload, or every question in one unit.

## No repeated questions
Run `supabase/norepeat.sql` (after `daily.sql`). A student never gets the same question twice in full-mock or unit tests until they restart that unit (or all units) from the dashboard. Restarting keeps past scores and the leaderboard. Practice tests and the Test of the day do not use up questions.

## Download, correct and re-upload (admin)
Run `supabase/export.sql` (after `batches.sql`). In the admin **Import** tab, download questions (all, one unit, one upload, or only reported ones) as a CSV that includes an `id` column. After correcting it, upload it again: rows with an id update that question in place; rows without an id are added as new.

## Android app
`android/` is a small app that opens the live website in a full-screen window, so every site update appears in the app automatically. GitHub builds it (Actions tab, "Build Android app"); the file is on the repo's Releases page as `SanskritNET.apk`. It is signed with a fixed key, so a newer APK installs over the old one. For Google Play you would create your own private key instead of the one in this repo.
