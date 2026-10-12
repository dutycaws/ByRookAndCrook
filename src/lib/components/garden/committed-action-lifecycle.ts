/** Keep the submitted Garden card locked and visible until fresh state has loaded. */
export async function finishCommittedGardenAction(effects: {
  playBurn: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  returnToUpdatedPlot: () => void;
}): Promise<void> {
  await effects.playBurn();
  await effects.refreshSnapshot();
  effects.returnToUpdatedPlot();
}
