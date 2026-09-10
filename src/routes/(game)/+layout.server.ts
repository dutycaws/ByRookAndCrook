import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');

  return { userEmail: user.email ?? 'Tavern keeper' };
};
