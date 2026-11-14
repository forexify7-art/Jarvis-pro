export function containsAsciiControlCharacters(value, {
  includeSpace = false,
  allowTab = false,
  allowLineFeed = false,
} = {}) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if ((allowTab && codePoint === 0x09) || (allowLineFeed && codePoint === 0x0a)) continue;
    if (codePoint <= (includeSpace ? 0x20 : 0x1f) || codePoint === 0x7f) return true;
  }
  return false;
}

export function replaceAsciiControlCharacters(value, replacement = ' ') {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    result += codePoint <= 0x1f || codePoint === 0x7f ? replacement : character;
  }
  return result;
}
