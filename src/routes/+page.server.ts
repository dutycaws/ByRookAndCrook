import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = await locals.getVerifiedUser();
  redirect(303, user ? '/garden' : '/login');
};
