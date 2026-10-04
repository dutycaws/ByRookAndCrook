import { describe, expect, it } from 'vitest';
import { _reviewerDecisionArgs } from '../../src/routes/(game)/admin/npcs/+page.server.js';

describe('reviewer V2 decision transport', () => {
  it('sends only server-issued option IDs for an approval and never restores rating', () => {
    const form = new FormData();
    form.set('versionId', '11111111-1111-4111-8111-111111111111');
    form.set('decision', 'approve');
    form.set('notes', 'Campaign methods are covered.');
    form.append('optionId', 'quest.action.prepare');
    form.append('optionId', 'quest.approach.scouting');

    expect(_reviewerDecisionArgs(form)).toEqual({
      p_version_id: '11111111-1111-4111-8111-111111111111',
      p_decision: 'approve',
      p_notes: 'Campaign methods are covered.',
      p_rating: null,
      p_option_ids: ['quest.action.prepare', 'quest.approach.scouting']
    });
  });

  it('strips capability fields from request-changes and rejection decisions', () => {
    const form = new FormData();
    form.set('versionId', '11111111-1111-4111-8111-111111111111');
    form.set('decision', 'request_changes');
    form.append('optionId', 'quest.action.prepare');

    expect(_reviewerDecisionArgs(form)).toMatchObject({
      p_decision: 'request_changes', p_option_ids: [], p_rating: null
    });
  });
});
