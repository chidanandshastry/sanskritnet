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
