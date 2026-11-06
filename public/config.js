// Fill these two values from Supabase > Project Settings > API.
// The anon/publishable key is safe to be public: the database rules
// in schema.sql protect the data.
window.APP_CONFIG = {
  SUPABASE_URL: "https://mggwsnvsiladaewmoqgg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Ua6cqtCMgGV9RZ9xarY3WQ_UQIh_Yv3",

  QUESTIONS_PER_TEST: 100,   // questions in every test
  MINUTES_PER_QUESTION: 1.2  // 100 questions = 120 minutes (keep in sync with schema.sql: 72 sec)
};
