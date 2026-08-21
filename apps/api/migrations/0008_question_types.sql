ALTER TABLE generation_jobs
ADD COLUMN question_types_json TEXT NOT NULL
DEFAULT '["multiple_choice","true_false","short_answer"]';
