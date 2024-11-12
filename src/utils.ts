function getUrlFromTemplate(template: string, item: string): string {
  return template ? template.replace('{item}', item) : item;
}

function isCosmosSdkNewerOrEqual(a: string, b: string): boolean {
  const parseVersion = (version: string) => {
    const [main] = version.replace(/^v/, '').split('-');
    const [major, minor, patch] = main.split('.').map((x) => parseInt(x, 10));
    return { major, minor, patch };
  };

  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  if (versionA.major !== versionB.major) {
    return versionA.major > versionB.major;
  }

  if (versionA.minor !== versionB.minor) {
    return versionA.minor > versionB.minor;
  }

  return versionA.patch >= versionB.patch;
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export { getUrlFromTemplate, isCosmosSdkNewerOrEqual, escapeMarkdownV2 };
