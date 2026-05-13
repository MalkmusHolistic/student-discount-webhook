/**
 * University Email Validator — imported from student-discount-email-validation
 * Statically loaded for O(1) lookups.
 */

const domainsData = await import('./university-domains.json', { with: { type: 'json' } });

const allDomainsSet = new Set();
const domainToUni = new Map();

if (Array.isArray(domainsData.default)) {
  for (const entry of domainsData.default) {
    if (entry && Array.isArray(entry.domains)) {
      const uniName = entry.name || '';
      for (const domain of entry.domains) {
        const normalized = domain.toLowerCase().trim();
        if (normalized) {
          allDomainsSet.add(normalized);
          domainToUni.set(normalized, uniName);
        }
      }
    }
  }
}

function isEmailFormat(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function getEmailDomain(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at >= email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

function isValidEmail(email, domainList = allDomainsSet) {
  if (!isEmailFormat(email)) {
    return { valid: false, domain: '', message: 'Invalid email format' };
  }

  const emailDomain = getEmailDomain(email);
  if (!emailDomain) {
    return { valid: false, domain: '', message: 'Could not extract domain' };
  }

  if (domainList.has(emailDomain)) {
    const uni = domainToUni.get(emailDomain);
    return { valid: true, domain: emailDomain, university: uni || undefined };
  }

  for (const knownDomain of domainList) {
    if (emailDomain.endsWith('.' + knownDomain)) {
      const uni = domainToUni.get(knownDomain);
      return { valid: true, domain: knownDomain, university: uni || undefined };
    }
  }

  return { valid: false, domain: emailDomain, message: 'Domain not found in university database' };
}

export { isValidEmail, allDomainsSet, domainToUni };
