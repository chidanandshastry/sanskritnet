// Fill these two values from Supabase > Project Settings > API.
// The anon/publishable key is safe to be public: the database rules
// in schema.sql protect the data.
window.APP_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",

  QUESTIONS_PER_TEST: 100,   // questions in every test
  MINUTES_PER_QUESTION: 1.2  // 100 questions = 120 minutes (keep in sync with schema.sql: 72 sec)
};
