type ErrorRecord = Record<string, unknown>;

function record(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === 'object' ? value as ErrorRecord : null;
}

function statusMessage(status: number, fallback: string): string | null {
  if (status === 400) return 'Some information is missing or invalid. Check it and try again.';
  if (status === 401) return 'Please sign in again to continue.';
  if (status === 403) return 'You do not have permission to do this.';
  if (status === 404) return 'This item is no longer available. Refresh and try again.';
  if (status === 408 || status === 504) return 'The request took too long. Check your connection and try again.';
  if (status === 409) return 'This item has changed or is already in use. Refresh and try again.';
  if (status === 413) return 'This request is too large. Reduce it and try again.';
  if (status === 429) return 'Too many attempts. Please wait a little and try again.';
  if (status >= 500) return 'The service is temporarily unavailable. Please try again shortly.';
  if (status === 200 || status === 201 || status === 204) return fallback;
  return null;
}

export function getUserFacingError(error: unknown, fallback: string): string {
  const details = record(error);
  const code = typeof details?.code === 'string' ? details.code : '';
  const rawMessage = typeof error === 'string'
    ? error
    : typeof details?.message === 'string'
      ? details.message
      : error instanceof Error ? error.message : '';
  const message = rawMessage.trim();
  const normalized = message.toLowerCase();
  const statusValue = details?.status ?? details?.statusCode;
  const status = typeof statusValue === 'number' ? statusValue : Number(statusValue);

  if (/passwords? do not match|password confirmation.*match/.test(normalized)) {
    return 'Passwords do not match. Re-enter the same password in both fields.';
  }
  if (/invalid username or password|invalid login credentials|invalid_credentials/.test(normalized) || code === 'invalid_credentials') {
    return 'Username or password is incorrect. Check both and try again.';
  }
  if (/username.*already (taken|exists|in use)|already.*username/.test(normalized)) {
    return 'That username is already taken. Choose another one.';
  }
  if (/invalid username/.test(normalized)) return 'Choose a username with 3–20 letters, numbers, or underscores.';
  if (/already voted/.test(normalized)) return 'You have already voted in this poll.';
  if (/report already exists/.test(normalized)) return 'You have already sent this report.';
  if (/report limit reached/.test(normalized)) return 'You have reached the report limit. Please try again later.';
  if (/invalid invitation code|invitation code.*(invalid|expired|used)|invalid or used invitation/.test(normalized)) {
    return 'This invitation code is invalid or has already been used. Check the code or ask for a new invitation.';
  }
  if (/invitation code is required/.test(normalized)) return 'Enter your campus invitation code to continue.';
  if (/invitation code.*(revoked|no longer active)/.test(normalized)) return 'This invitation code is no longer active. Ask for a new invitation.';
  if (/at least 10 characters|stronger password|password.*too short/.test(normalized)) return 'Choose a password with at least 10 characters.';
  if (/daily post limit reached/.test(normalized)) return 'You have reached today’s posting limit. Try again tomorrow.';
  if (/post text must be 1 to 500|comment must be 1 to 500/.test(normalized)) return 'Text must be between 1 and 500 characters.';
  if (/message must be 1 to 500/.test(normalized)) return 'Messages must be between 1 and 500 characters.';
  if (/polls need 2 to 6 options/.test(normalized)) return 'A poll needs between 2 and 6 options.';
  if (/poll options must be 1 to 80/.test(normalized)) return 'Each poll option must be between 1 and 80 characters.';
  if (/heic|heif/.test(normalized) && /image|photo/.test(normalized)) return 'Export the photo as JPG, PNG, or WebP, then try again.';
  if (/image could not be opened|undecodable image/.test(normalized)) return 'This image could not be opened. Export it as JPG, PNG, or WebP and try again.';
  if (/invalid poll text/.test(normalized)) return 'Poll questions must be 8–200 characters, and the tag can be up to 40 characters.';
  if (/options must be an array|invalid poll options/.test(normalized)) return 'Choose valid options for this poll and try again.';
  if (/invalid spotted post/.test(normalized)) return 'Add a recipient name and keep the note within 500 characters.';
  if (/slow down before sending another message|please wait before repeating a message/.test(normalized)) return 'Please wait a moment before sending another message.';
  if (/this chat has ended/.test(normalized)) return 'This chat has ended. Start a new chat to continue.';
  if (/recipient is unavailable/.test(normalized)) return 'This campus ghost is no longer available.';
  if (/anonymous identity is unavailable|anonymous profile unavailable/.test(normalized)) return 'Your anonymous profile is unavailable. Refresh the page and try again.';
  if (/choose a report reason|invalid report reason/.test(normalized)) return 'Choose a valid reason before sending the report.';
  if (/invalid report target/.test(normalized)) return 'This report target is no longer available.';
  if (/invalid reaction/.test(normalized)) return 'Choose a valid reaction and try again.';
  if (/image upload is unavailable/.test(normalized)) return 'This image is no longer available. Choose it again and retry.';
  if (code === '23505') return 'This has already been submitted.';
  if (code === '23503') return 'The item you selected is no longer available. Refresh and try again.';
  if (code === 'P0001') return 'This action is temporarily limited. Wait a moment and try again.';
  if (code === 'P0002' || code === 'PGRST116') return 'This item is no longer available. Refresh and try again.';
  if (code === 'PGRST301' || /jwt expired|session.*expired/.test(normalized)) return 'Your session expired. Sign in again to continue.';
  if (/registered active account required|active account required|sign in required/.test(normalized)) {
    return 'Sign in with an active account to do this.';
  }
  if (/too many attempts|rate limit/.test(normalized) || code === '429') return 'Too many attempts. Please wait 15 minutes and try again.';
  if (/suspended or banned|account is suspended|account is banned/.test(normalized)) return 'This account is suspended. Contact a campus moderator for help.';
  if (/row-level security|permission denied|not authorized|unauthorized/.test(normalized) || code === '42501' || code === 'PGRST301') {
    return 'You need to sign in with an account that has permission to do this.';
  }
  if (/violates .* constraint|invalid input syntax|malformed array literal/.test(normalized) || code === '22023' || code === '22P02' || code === '23514') {
    return 'Some information is invalid. Check the form and try again.';
  }
  if (/failed to fetch|failed to send a request|network request failed|networkerror|load failed|fetch failed|internet disconnected|relay error/.test(normalized)) {
    return 'Could not reach UNSEEN. Check your internet connection and try again.';
  }
  if (/statement timeout|connection refused|could not connect|database is unavailable|temporary server error/.test(normalized)) {
    return 'The service is temporarily unavailable. Please try again shortly.';
  }
  const statusOnly = normalized.match(/^(?:http\s*)?(\d{3})(?:\s+error)?$|^error:?\s*(\d{3})$|request failed with status code\s+(\d{3})/);
  if (/edge function returned a non-2xx|^\[object object\]$/.test(normalized) || statusOnly) {
    const reportedStatus = Number(statusOnly?.[1] ?? statusOnly?.[2] ?? statusOnly?.[3] ?? status);
    return statusMessage(Number.isFinite(reportedStatus) ? reportedStatus : 0, fallback) ?? fallback;
  }

  if (Number.isFinite(status) && status >= 400) return statusMessage(status, fallback) ?? fallback;

  // Avoid showing raw server internals while keeping useful validation messages.
  if (!message || /\b(sql|postgres|postgrest|supabase|jwt|stack trace|constraint|schema cache)\b/i.test(message)
    || /column reference .* is ambiguous/i.test(message)
    || /could not find the .* function|function .* does not exist|relation .* does not exist|column .* does not exist|cannot read properties|is not a function/i.test(message)
    || /^(?:type|reference|syntax)error:/i.test(message)) return fallback;
  return message;
}

export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = record(error)?.context;
  if (context instanceof Response) {
    try {
      const payload: unknown = await context.clone().json();
      const body = record(payload);
      const message = typeof body?.error === 'string'
        ? body.error
        : typeof body?.message === 'string' ? body.message : null;
      if (message) return getUserFacingError(message, fallback);
    } catch {
      // A non-JSON response has no safe user message; use its HTTP status below.
    }
    const status = context.status;
    return statusMessage(status, getUserFacingError(error, fallback)) ?? getUserFacingError(error, fallback);
  }
  return getUserFacingError(error, fallback);
}
