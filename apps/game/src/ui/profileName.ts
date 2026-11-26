// How the UI shows a profile name: a profile nobody named (meta/save.ts DEFAULT_PROFILE_NAME) reads "Hero" / "Kahraman" in the player's
// language instead of the stored Turkish word in every language (QA EXPLORER-1).
import { t } from '../i18n/i18n';
import { isDefaultProfileName } from '../meta/save';

export function profileLabel(name: string): string {
  return isDefaultProfileName(name) ? t('profile.defaultName') : name;
}

/** What the profile name field holds: empty for an unnamed profile (the placeholder asks for a name), else the name. */
export function profileFieldValue(name: string): string {
  return isDefaultProfileName(name) ? '' : name;
}
