import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (await locals.getVerifiedUser()) redirect(303, '/garden');
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = await request.formData();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!email || !password) {
      return fail(400, { email, message: 'Enter both your email and password.' });
    }

    const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return fail(400, { email, message: 'Those credentials did not open the tavern ledger.' });
    }

    redirect(303, '/garden');
  }
};
