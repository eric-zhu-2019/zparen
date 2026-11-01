/** A model's id as people say it: claude-opus-5-5 is Claude Opus 5.5, gpt-5.1 is GPT-5.1. */
export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(id);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${family[0].toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`;
  }
  if (/^gpt-/.test(id)) return `GPT-${id.slice(4)}`;
  return id;
}
