function getUrlFromTemplate(template: string, item: string): string {
  return template ? template.replace('{item}', item) : item;
}

function getVoteMessageType(cosmosSdkVersion: string): string {
  return isCosmosSdkNewerOrEqual(cosmosSdkVersion, 'v0.47.0')
    ? '/cosmos.gov.v1.MsgVote'
    : '/cosmos.gov.v1beta1.MsgVote';
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

export { getUrlFromTemplate, getVoteMessageType };
