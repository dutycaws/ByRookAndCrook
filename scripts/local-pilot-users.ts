export type LocalPilotAccount = Readonly<{
  email: string;
  password: string;
}>;

type LocalPilotUser = Readonly<{
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}>;

type LocalPilotAdmin = Readonly<{
  listUsers: (options: { perPage: number }) => Promise<{
    data: { users: LocalPilotUser[] } | null;
    error: Error | null;
  }>;
  updateUserById: (id: string, attributes: { email_confirm: true }) => Promise<{
    data: { user: LocalPilotUser | null } | null;
    error: Error | null;
  }>;
  createUser: (attributes: { email: string; password: string; email_confirm: true }) => Promise<{
    data: { user: LocalPilotUser | null } | null;
    error: Error | null;
  }>;
}>;

type LocalPilotClient = Readonly<{
  auth: Readonly<{
    admin: LocalPilotAdmin;
  }>;
}>;

export type LocalPilotUserResult = Readonly<{
  ids: Map<string, string>;
  created: string[];
  confirmed: string[];
  reused: string[];
}>;

/**
 * Creates missing local pilots while preserving active sessions for existing,
 * confirmed accounts. In particular, never rewrite their password on a routine
 * fixture rerun: Supabase invalidates active sessions when credentials change.
 */
export async function ensureLocalPilotUsers(
  admin: LocalPilotClient,
  accounts: readonly LocalPilotAccount[]
): Promise<LocalPilotUserResult> {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  if (!listed) throw new Error('Local pilot identity listing returned no data.');

  const ids = new Map<string, string>();
  const created: string[] = [];
  const confirmed: string[] = [];
  const reused: string[] = [];
  for (const account of accounts) {
    const existing = listed.users.find((user) => user.email === account.email);
    if (existing?.email_confirmed_at) {
      ids.set(account.email, existing.id);
      reused.push(account.email);
      continue;
    }

    const response = existing
      ? await admin.auth.admin.updateUserById(existing.id, { email_confirm: true })
      : await admin.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true
        });
    if (response.error) throw response.error;
    const user = response.data?.user;
    if (!user) throw new Error(`Local pilot ${account.email} did not return an identity.`);
    ids.set(account.email, user.id);
    if (existing) confirmed.push(account.email);
    else created.push(account.email);
  }

  return { ids, created, confirmed, reused };
}
