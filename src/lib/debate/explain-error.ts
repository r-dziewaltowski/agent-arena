/**
 * Turns the engine's technical error for a failed debate into a sentence for people, plus
 * whether resuming is likely to help. The raw message stays available as detail.
 */
export function explainFailure(errorMessage: string | null): { summary: string; canResume: boolean } {
  const m = errorMessage ?? "";
  if (/API_KEY is not set|api key/i.test(m)) {
    return { summary: "The model's provider isn't set up on this server (its API key is missing).", canResume: true };
  }
  if (/does not exist|not found|do not have access|model_not_found/i.test(m)) {
    return { summary: "The model this debate uses isn't available any more.", canResume: true };
  }
  if (/empty turn/i.test(m)) {
    return { summary: "The model kept returning empty replies.", canResume: true };
  }
  if (/safety filter/i.test(m)) {
    return {
      summary: "The model's safety filter kept blocking the reply. A different model, or a gentler topic or persona, may get through.",
      canResume: true,
    };
  }
  if (/provider is added in M5|anthropic/i.test(m)) {
    return { summary: "This debate uses a paid model that isn't supported yet.", canResume: false };
  }
  return { summary: "The model returned an error several times in a row.", canResume: true };
}
