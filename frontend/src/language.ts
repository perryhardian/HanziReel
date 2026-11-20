// New jobs use English. Indonesian is retained for legacy jobs, with no picker.
export function translationLanguageName(language: string) {
  return ({en: 'English', id: 'Indonesian'} as Record<string, string>)[language] ?? language;
}
