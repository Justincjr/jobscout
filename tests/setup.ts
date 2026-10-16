// Routine tests must never use a developer's real provider credentials.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
