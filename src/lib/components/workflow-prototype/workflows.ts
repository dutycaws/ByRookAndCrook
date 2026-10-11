import type {
	WorkflowArea,
	WorkflowChoice,
	WorkflowDefinition,
	WorkflowNode,
	WorkflowSceneContext
} from './types';

const c = (
	id: string,
	title: string,
	next?: string,
	detail?: string,
	icon?: string,
	eyebrow?: string
): WorkflowChoice => ({ id, title, next, detail, icon, eyebrow });

const n = (
	id: string,
	title: string,
	description: string,
	choices: WorkflowChoice[],
	extra: Partial<Omit<WorkflowNode, 'id' | 'title' | 'description' | 'choices'>> = {}
): WorkflowNode => ({ id, title, description, choices, ...extra });

const scene = (id: string, label: string, detail?: string): WorkflowSceneContext => ({ id, label, detail });


function definition(
	area: WorkflowArea,
	title: string,
	initialNodeId: string,
	nodes: WorkflowNode[],
	sceneAliases: Record<string, string> = {}
): WorkflowDefinition {
	const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
	for (const [alias, targetId] of Object.entries(sceneAliases)) {
		const target = nodeMap[targetId];
		if (target) nodeMap[alias] = { ...target, id: alias };
	}

	return {
		area,
		title,
		initialNodeId,
		nodes: nodeMap
	};
}

const bar = definition('bar', 'By Rook and Crook', 'bar-root', [
	n('bar-root', 'The tavern', 'Choose a patron, keepsake, journal, or closing action directly from the scene.', [], { kind: 'menu', scene: scene('root', 'The tavern', 'Warm lamplight, a well-worn counter, and a room full of small stories.') }),
	n('bar-resident', 'Lira has the floor', 'Talk, offer a drink, or take a closer look at the person across from you.', [
		c('talk-to-lira', 'Start a conversation', 'bar-talk', 'Ask what has been on her mind.', '“', 'TALK'),
		c('serve-lira', 'Offer a drink', 'bar-serve', 'Choose something from the house.', '♨', 'SERVE'),
		c('inspect-lira', 'Notice the details', 'bar-inspect', 'A pocket-sized portrait of the moment.', '⌕', 'INSPECT'),
		c('back-to-room', 'Back to the room', 'bar-root', 'Return to the tavern.', '←')
	], { kind: 'inspection', scene: scene('resident', 'Lira', 'A familiar patron settles in for a quiet evening.') }),
	n('bar-talk', 'A quiet word', 'This is a local conversation mockup. Your note stays in the prototype and does not reach a game service.', [
		c('continue-chat', 'Keep talking', 'bar-resident', 'Return to the conversation choices.', '↗'),
		c('chat-journal', 'Leave a note in the journal', 'bar-journal', 'See what the house remembers.', '▤'),
		c('leave-chat', 'Give Lira some space', 'bar-resident', 'Return to Lira’s table.', '←')
	], {
		kind: 'chat',
		scene: scene('resident', 'Lira', 'A conversation held in the soft noise of the tavern.'),
		chat: {
			messages: [
				{ speaker: 'Lira', text: 'It is good to have a familiar face behind the bar. How has the garden been?' }
			],
			input: {
				placeholder: 'Write a kind reply…',
				submitLabel: 'Send',
				response: { speaker: 'Lira', text: 'I will have to come by and see it for myself.' }
			}
		}
	}),
	n('bar-serve', 'Something for the table', 'Choose an order to preview the serving interaction. No stock or game state changes are made.', [
		c('serve-ale', 'House ale', 'bar-served', 'A familiar amber pour.', '🍺', 'HOUSE'),
		c('serve-cider', 'Spiced cider', 'bar-served', 'Warm apples, clove, and a little patience.', '♨', 'WARM'),
		c('serve-tea', 'Juniper tea', 'bar-served', 'A gentler cup for a long evening.', '☕', 'GARDEN'),
		c('serve-back', 'Back to Lira', 'bar-resident', 'Keep the conversation going.', '←')
	], { kind: 'activity', scene: scene('resident', 'Lira', 'The bar menu is ready when Lira is.') }),
	n('bar-served', 'A small kindness', 'The serving flow ends with local feedback for the prototype.', [
		c('another-drink', 'Offer something else', 'bar-serve', 'Choose another house favorite.', '♨'),
		c('return-lira', 'Back to Lira', 'bar-resident', 'Return to the table.', '←'),
		c('return-room', 'Back to the room', 'bar-root', 'See the whole tavern again.', '⌂')
	], { kind: 'result', scene: scene('resident', 'Lira', 'The offered drink catches the warm light.'), result: { title: 'Served with care', detail: 'Lira wraps both hands around the cup and settles in.', tone: 'success' } }),
	n('bar-inspect', 'A few things Lira lets show', 'The familiar warmth of the tavern seems to put Lira at ease.', [
		c('inspect-back', 'Back to Lira', 'bar-resident', 'Return to the interaction.', '←'),
		c('inspect-journal', 'Read the house journal', 'bar-journal', 'See earlier notes from the room.', '▤')
	], { kind: 'inspection', scene: scene('resident', 'Lira', 'A glance at the person, not another dashboard panel.') }),
	n('trinkets', 'Keepsakes on the counter', 'Two small objects invite a closer look. Their display choices stay local to this prototype.', [
		c('inspect-fair-measure-seal', 'Fair Measure Seal', 'bar-fair-measure-seal', 'A small emblem kept close to the counter.', '✧', 'KEEPSAKE'),
		c('inspect-roadkeeper-leaf', 'Roadkeeper Leaf', 'bar-roadkeeper-leaf', 'A pressed leaf saved from a long road.', '❋', 'KEEPSAKE'),
		c('trinkets-back', 'Back to the tavern', 'bar-root', 'Return to the room.', '←')
	], { kind: 'menu', scene: scene('trinkets', 'Tavern keepsakes', 'The counter display stays in view while each keepsake can be inspected.') }),
	n('bar-fair-measure-seal', 'Fair Measure Seal', 'A closer look at a keepsake displayed beside the counter.', [
		c('seal-display', 'Keep it on display', 'trinkets', 'Return to the keepsake display.', '✧'),
		c('seal-room', 'Back to the tavern', 'bar-root', 'Return to the room.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Fair Measure Seal', 'A small emblem, displayed rather than collected or consumed.') }),
	n('bar-roadkeeper-leaf', 'Roadkeeper Leaf', 'A closer look at the pressed leaf kept among the tavern’s small reminders.', [
		c('leaf-display', 'Keep it on display', 'trinkets', 'Return to the keepsake display.', '❋'),
		c('leaf-room', 'Back to the tavern', 'bar-root', 'Return to the room.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Roadkeeper Leaf', 'A pressed leaf, displayed as a small reminder of the road.') }),
	n('bar-journal', 'House journal', 'A few remembered details, kept together in one quiet destination.', [
		c('journal-room', 'Back to the tavern', 'bar-root', 'Return to the room.', '⌂')
	], {
		kind: 'journal',
		scene: scene('root', 'The house journal', 'A concise record of the tavern’s recent moments.'),
		entries: [
			{ title: 'A familiar face', detail: 'Lira stopped by for a quiet drink and a little conversation.', when: 'Tonight' },
			{ title: 'A warm welcome', detail: 'The house kept a place open for anyone needing a quiet word.', when: 'Earlier' }
		]
	}),
	n('bar-close', 'Call the evening', 'Take a last look at tonight before closing the doors.', [
		c('review-till', 'Preview tonight’s settlement', 'bar-close-summary', 'See the closeout in this local mockup.', '▤', 'REVIEW'),
		c('close-return', 'Keep the room open', 'bar-root', 'Step back into the evening.', '←')
	], { kind: 'activity', scene: scene('close', 'Closing time', 'The lamps are low. The final choice belongs to the host.') }),
	n('bar-close-summary', 'The last page of tonight', 'A readable closeout with no account or inventory updates.', [
		c('confirm-close', 'Finish the evening', 'bar-closed', 'Show the closing note.', '☾', 'CLOSE'),
		c('close-summary-back', 'Back to closing time', 'bar-close', 'Review the closeout again.', '←'),
		c('close-summary-room', 'Return to the room', 'bar-root', 'Keep the prototype in the open-tavern state.', '⌂')
	], { kind: 'inspection', scene: scene('close', 'Closing note', 'One compact summary instead of a permanent dashboard card.') }),
	n('bar-closed', 'The door is latched for the night', 'The prototype shows the completed closing state without settling a real session.', [
		c('reopen-preview', 'Return to the tavern', 'bar-root', 'Resume the local prototype.', '⌂')
	], { kind: 'result', scene: scene('close', 'Closed for the night'), result: { title: 'Evening complete', detail: 'The last lamp glows in the front window.', tone: 'success' } })
], { root: 'bar-root', resident: 'bar-resident', close: 'bar-close' });

const garden = definition('garden', 'Garden', 'garden-root', [
	n('garden-root', 'The garden', 'Select a plot or apiary directly from the scene to see its relevant actions.', [], { kind: 'menu', scene: scene('root', 'The garden', 'A working patch of herbs, flowers, and careful experiments.') }),
	n('plot-empty', 'An empty bed', 'Start with the soil, choose a seed, or return to the garden overview.', [
		c('empty-plant', 'Plant a seed', 'garden-plant', 'Choose what this patch might become.', '✿', 'PLANT'),
		c('empty-amend', 'Amend the soil', 'garden-amend', 'Preview a soil improvement.', '♲', 'CARE'),
		c('empty-compost', 'Add compost', 'garden-compost', 'Choose a compost blend.', '♲'),
		c('empty-overview', 'Back to the garden', 'garden-root', 'Choose another patch.', '←')
	], { kind: 'inspection', scene: scene('plot-empty', 'Empty plot', 'Dark, crumbly earth with room for a new beginning.') }),
	n('plot-growing', 'A bed in leaf', 'Choose the action that fits the growing plants in front of you.', [
		c('growing-water', 'Water', 'garden-water', 'A light drink for the roots.', '⌁', 'CARE'),
		c('growing-amend', 'Amend the soil', 'garden-amend', 'Top up the bed’s nutrients.', '♲', 'CARE'),
		c('growing-harvest', 'Harvest', 'garden-harvest', 'Gather what is ready.', '✂', 'GATHER'),
		c('growing-move', 'Move a plant', 'garden-move', 'Preview a move to a nearby bed.', '↗', 'RESHAPE'),
		c('growing-remove', 'Remove a plant', 'garden-remove', 'Clear a plant from this patch.', '×', 'RESHAPE'),
		c('growing-compost', 'Visit the compost', 'garden-compost', 'Use the shared compost destination.', '♲'),
		c('growing-batch', 'Plan a harvest batch', 'garden-batch', 'Collect ingredients in a local batch preview.', '▦'),
		c('growing-overview', 'Back to the garden', 'garden-root', 'Choose another patch.', '←')
	], { kind: 'inspection', scene: scene('plot-growing', 'Growing plot', 'Soft leaves and small buds move in the breeze.') }),
	n('plot-hive', 'The pollinator bed', 'Flowers and a compact apiary share this corner of the garden.', [
		c('hive-apiary', 'Inspect the apiary', 'garden-apiary', 'Check the hive and its quiet work.', '⌁', 'APIARY'),
		c('hive-move', 'Move a plant', 'garden-move', 'Preview a careful move to another bed.', '↗', 'RESHAPE'),
		c('hive-remove', 'Remove a plant', 'garden-remove', 'Clear a plant from this patch.', '×', 'RESHAPE'),
		c('hive-compost', 'Visit the compost', 'garden-compost', 'Choose a compost blend.', '♲'),
		c('hive-overview', 'Back to the garden', 'garden-root', 'Choose another patch.', '←')
	], { kind: 'inspection', scene: scene('plot-hive', 'Pollinator bed', 'Wildflowers trace a bright path around the hive.') }),
	n('garden-plant', 'Choose a seed', 'Pick a plant for the empty bed. The result is a local preview only.', [
		c('plant-mint', 'Mint', 'garden-planted', 'Fragrant, quick to spread, and useful in a cool drink.', '❋', 'HERB'),
		c('plant-thyme', 'Thyme', 'garden-planted', 'A sturdy herb for sunny edges.', '❋', 'HERB'),
		c('plant-marigold', 'Marigold', 'garden-planted', 'A bright companion for nearby crops.', '✿', 'FLOWER'),
		c('plant-back-empty', 'Back to the empty bed', 'plot-empty', 'Keep the soil ready for later.', '←')
	], { kind: 'activity', scene: scene('plot-empty', 'Seed selection', 'A short seed list keeps planting close to the selected plot.') }),
	n('garden-planted', 'A new start', 'The bed now has a local plant preview.', [
		c('planted-view-growing', 'View the growing bed', 'plot-growing', 'Continue with the growing-plot actions.', '✿')
	], { kind: 'result', scene: scene('plot-growing', 'Newly planted bed'), result: { title: 'Seed tucked into the soil', detail: 'A small marker remembers the choice in this prototype.', tone: 'success' } }),
	n('garden-water', 'Water the bed', 'A focused care step with a clear way back to the selected patch.', [
		c('water-gently', 'Water gently', 'garden-watered', 'Give the roots a steady drink.', '⌁', 'CARE'),
		c('water-back', 'Back to the plot', 'plot-growing', 'Leave the watering can here.', '←')
	], { kind: 'activity', scene: scene('plot-growing', 'Watering', 'The bed remains the visual anchor during the care action.') }),
	n('garden-watered', 'A little rain, on purpose', 'The plants look refreshed in this local action preview.', [
		c('watered-continue', 'Return to the growing bed', 'plot-growing', 'Choose the next useful action.', '✿')
	], { kind: 'result', scene: scene('plot-growing', 'Watered plot'), result: { title: 'Watered', detail: 'The soil darkens and the leaves lift.', tone: 'success' } }),
	n('garden-amend', 'Amend the soil', 'Choose a small soil treatment for the selected bed.', [
		c('amend-compost', 'Finished compost', 'garden-amended', 'Gentle, balanced organic matter.', '♲', 'SOIL'),
		c('amend-leaf-mould', 'Leaf mould', 'garden-amended', 'A light texture for thirsty soil.', '♲', 'SOIL'),
		c('amend-back', 'Back to the plot', 'plot-growing', 'Keep the bed as it is.', '←')
	], { kind: 'activity', scene: scene('plot-growing', 'Soil care', 'A small choice, made in context with the selected patch.') }),
	n('garden-amended', 'Soil refreshed', 'The soil-care choice is shown as a local preview.', [
		c('amended-growing', 'Return to the growing bed', 'plot-growing', 'See the rest of the plot actions.', '✿'),
		c('amended-empty', 'Return to the empty bed', 'plot-empty', 'Continue preparing the bare soil.', '←')
	], { kind: 'result', scene: scene('plot-growing', 'Amended plot'), result: { title: 'Soil amended', detail: 'The selected blend is ready for the next season.', tone: 'success' } }),
	n('garden-harvest', 'Gather what is ready', 'Select a harvest preview from the growing bed.', [
		c('harvest-mint', 'Mint sprigs', 'garden-harvested', 'A fragrant handful for the basket.', '❋', 'READY'),
		c('harvest-thyme', 'Thyme tips', 'garden-harvested', 'Small leaves, gathered carefully.', '❋', 'READY'),
		c('harvest-back', 'Back to the plot', 'plot-growing', 'Wait for another day.', '←')
	], { kind: 'activity', scene: scene('plot-growing', 'Harvest', 'Gathering stays attached to the growing bed.') }),
	n('garden-harvested', 'Basket filled', 'This local result previews a harvest without changing game inventory.', [
		c('harvest-again', 'Gather another sprig', 'garden-harvest', 'Return to the harvest choices.', '✂'),
		c('harvest-batch', 'Plan a batch with it', 'garden-batch', 'Bring ingredients to the batch preview.', '▦'),
		c('harvest-return', 'Back to the growing bed', 'plot-growing', 'Continue tending the plot.', '←')
	], { kind: 'result', scene: scene('plot-growing', 'Harvest basket'), result: { title: 'Gathered', detail: 'A small harvest is ready for the next local step.', tone: 'success' } }),
	n('garden-move', 'Move a plant', 'Choose a nearby destination for a local relocation preview.', [
		c('move-empty', 'Move to the empty bed', 'garden-moved', 'Make room in the growing bed.', '↗', 'DESTINATION'),
		c('move-growing', 'Reposition in the growing bed', 'garden-moved', 'Shift to a sunnier edge.', '↗', 'DESTINATION'),
		c('move-back', 'Keep it here', 'plot-growing', 'Cancel the preview.', '←')
	], { kind: 'activity', scene: scene('plot-growing', 'Plant relocation', 'A destination choice makes the action’s outcome clear.') }),
	n('garden-moved', 'A new place to grow', 'The relocation is a visual preview only.', [
		c('moved-empty', 'See the empty bed', 'plot-empty', 'Return to the destination bed.', '＋'),
		c('moved-growing', 'Back to the growing bed', 'plot-growing', 'Continue tending this patch.', '✿')
	], { kind: 'result', scene: scene('plot-growing', 'Moved plant'), result: { title: 'Plant moved', detail: 'The prototype shows where the plant would settle.', tone: 'success' } }),
	n('garden-remove', 'Clear a plant', 'Review the removal choice before showing its local result.', [
		c('remove-confirm', 'Preview removal', 'garden-removed', 'The selected plant leaves this patch in the mockup.', '×', 'CLEAR'),
		c('remove-cancel', 'Keep the plant', 'plot-growing', 'Return without changes.', '←')
	], { kind: 'activity', scene: scene('plot-growing', 'Plant removal', 'The plot stays visible while the choice is reviewed.') }),
	n('garden-removed', 'The patch has more room', 'This is a reversible prototype state, not a real garden mutation.', [
		c('removed-empty', 'View the empty bed', 'plot-empty', 'Open the cleared-bed actions.', '＋'),
		c('removed-overview', 'Back to the garden', 'garden-root', 'Choose another garden destination.', '←')
	], { kind: 'result', scene: scene('plot-empty', 'Cleared bed'), result: { title: 'Plant removed', detail: 'The bed is ready for another choice.', tone: 'neutral' } }),
	n('garden-apiary', 'A quiet apiary', 'The hive is active in the scene; these are inspection and care previews.', [
		c('apiary-check', 'Check the hive', 'garden-apiary-result', 'Listen for the colony and inspect the frame.', '⌁', 'INSPECT'),
		c('apiary-move', 'Move the apiary', 'garden-move', 'Preview choosing a new spot.', '↗', 'RESHAPE'),
		c('apiary-back', 'Back to the pollinator bed', 'plot-hive', 'Return to the selected garden corner.', '←')
	], { kind: 'activity', scene: scene('plot-hive', 'Apiary', 'The pollinator bed remains in view.') }),
	n('garden-apiary-result', 'The hive is humming', 'The local apiary inspection finds a calm, active colony.', [
		c('apiary-result-back', 'Back to the pollinator bed', 'plot-hive', 'Return to the flowers and hive.', '←')
	], { kind: 'result', scene: scene('plot-hive', 'Apiary inspection'), result: { title: 'All is quiet', detail: 'Bees move steadily between the hive and the flowers.', tone: 'success' } }),
	n('garden-compost', 'Compost corner', 'Choose a local compost blend, then return to the plot that needs it.', [
		c('compost-greens', 'Leafy greens', 'garden-compost-result', 'A fresh, nitrogen-rich mix.', '♲', 'BLEND'),
		c('compost-browns', 'Dry leaves', 'garden-compost-result', 'A slow, airy layer.', '♲', 'BLEND'),
		c('compost-return', 'Back to the garden', 'garden-root', 'Choose a different destination.', '←')
	], { kind: 'activity', scene: scene('root', 'Compost corner', 'The shared garden resource has its own small destination.') }),
	n('garden-compost-result', 'Compost ready', 'The blend is selected for the prototype flow.', [
		c('compost-to-empty', 'Use it on the empty bed', 'plot-empty', 'Continue preparing soil.', '＋'),
		c('compost-to-growing', 'Use it on the growing bed', 'plot-growing', 'Return to the plants.', '✿'),
		c('compost-back', 'Back to compost', 'garden-compost', 'Choose another blend.', '♲')
	], { kind: 'result', scene: scene('root', 'Compost selection'), result: { title: 'Blend ready', detail: 'A small basket of compost is waiting by the path.', tone: 'success' } }),
	n('garden-batch', 'Plan a small batch', 'Gather a few garden ingredients for a local crafting preview.', [
		c('batch-mint', 'Add mint', 'garden-batch-result', 'A cool note for a garden batch.', '❋', 'INGREDIENT'),
		c('batch-thyme', 'Add thyme', 'garden-batch-result', 'A savory garden note.', '❋', 'INGREDIENT'),
		c('batch-flower', 'Add petals', 'garden-batch-result', 'A bright finishing touch.', '✿', 'INGREDIENT'),
		c('batch-back', 'Back to the garden', 'garden-root', 'Leave the basket empty.', '←')
	], { kind: 'activity', scene: scene('root', 'Garden batch', 'The batch is a named destination, not a permanent dashboard panel.') }),
	n('garden-batch-result', 'A garden batch takes shape', 'The basket shows a mock combination without starting a real production action.', [
		c('batch-add-more', 'Add another ingredient', 'garden-batch', 'Keep shaping the local preview.', '＋'),
		c('batch-finish', 'Finish this preview', 'garden-batch-finished', 'Show the mock batch note.', '✓'),
		c('batch-result-back', 'Back to the garden', 'garden-root', 'Return to the scene.', '←')
	], { kind: 'inspection', scene: scene('root', 'Batch basket', 'Ingredients stay grouped in the moment they become relevant.') }),
	n('garden-batch-finished', 'Batch preview complete', 'No brew, bake, or inventory command was submitted.', [
		c('batch-done-garden', 'Back to the garden', 'garden-root', 'Return to the beds.', '←'),
		c('batch-done-again', 'Plan another batch', 'garden-batch', 'Choose another garden combination.', '▦'),
		c('batch-done-compost', 'Visit the compost', 'garden-compost', 'Return to the shared garden resource.', '♲')
	], { kind: 'result', scene: scene('root', 'Batch preview'), result: { title: 'Batch noted', detail: 'The ingredient combination remains a local visual preview.', tone: 'success' } })
], { root: 'garden-root' });

const brewery = definition('brewery', 'Brewery', 'brewery-root', [
	n('brewery-root', 'A batch is waiting', 'Choose ingredients, tend the kettle, or review the finish of this local brew flow.', [
		c('brew-select', 'Choose ingredients', 'brewery-select', 'Build a small batch from the pantry.', '＋', 'SELECT'),
		c('brew-stir', 'Stir the kettle', 'brewery-stir', 'Continue a mock batch in progress.', '↻', 'ACTION'),
		c('brew-finish', 'Preview the finish', 'brewery-finished', 'See the result state without submitting a brew action.', '✓', 'FINISH')
	], { kind: 'menu', scene: scene('root', 'Brewery', 'Copper, steam, and a clear view of the work surface.') }),
	n('brewery-select', 'Choose the batch ingredients', 'Select a local ingredient combination for the brew preview.', [
		c('brew-select-malt', 'Pale malt', 'brewery-selected', 'A clean, bready base.', '▤', 'GRAIN'),
		c('brew-select-honey', 'Garden honey', 'brewery-selected', 'A floral sweetness from the apiary.', '✿', 'SWEET'),
		c('brew-select-herbs', 'Juniper and mint', 'brewery-selected', 'A bright, aromatic finish.', '❋', 'BOTANICAL'),
		c('brew-select-back', 'Back to the brewery', 'brewery-root', 'Leave the batch as it is.', '←')
	], { kind: 'activity', scene: scene('root', 'Ingredient selection', 'The scene stays put while the batch choice comes forward.') }),
	n('brewery-selected', 'The ingredients are together', 'A local recipe preview is ready for the next step.', [
		c('brew-selected-stir', 'Stir the kettle', 'brewery-stir', 'Move into the active step.', '↻'),
		c('brew-selected-adjust', 'Adjust ingredients', 'brewery-select', 'Swap one choice in the preview.', '＋'),
		c('brew-selected-finish', 'Preview the finish', 'brewery-finished', 'Skip to the local result.', '✓')
	], { kind: 'inspection', scene: scene('root', 'Batch ingredients', 'A concise view of the selected blend.') }),
	n('brewery-stir', 'Tend the kettle', 'Choose a stirring rhythm. This prototype step only changes the visible local state.', [
		c('brew-stir-slow', 'Stir slowly', 'brewery-stirred', 'Keep the blend gentle and even.', '↻', 'GENTLE'),
		c('brew-stir-steady', 'Stir steadily', 'brewery-stirred', 'Keep a measured rhythm.', '↻', 'STEADY'),
		c('brew-stir-back', 'Back to the batch', 'brewery-selected', 'Review the ingredient preview.', '←')
	], { kind: 'activity', scene: scene('root', 'Kettle', 'The kettle is the active work surface for this step.') }),
	n('brewery-stirred', 'The blend settles', 'The local brew preview is ready to finish or adjust.', [
		c('brew-stirred-again', 'Stir once more', 'brewery-stir', 'Choose another rhythm.', '↻'),
		c('brew-stirred-finish', 'Finish the batch', 'brewery-finished', 'Preview the completed batch.', '✓'),
		c('brew-stirred-select', 'Adjust ingredients', 'brewery-select', 'Return to ingredient choices.', '＋')
	], { kind: 'result', scene: scene('root', 'Settled batch'), result: { title: 'Kettle tended', detail: 'The surface is calm and the blend is ready for its final preview.', tone: 'success' } }),
	n('brewery-finished', 'A finished batch', 'The brewing path ends in a local result; no gameplay action was submitted.', [
		c('brew-finish-again', 'Shape another batch', 'brewery-select', 'Return to the ingredient choices.', '＋'),
		c('brew-finish-home', 'Back to the brewery', 'brewery-root', 'Return to the work surface.', '←')
	], { kind: 'result', scene: scene('root', 'Finished batch'), result: { title: 'Batch complete', detail: 'A bright, botanical brew is ready to be imagined.', tone: 'success' } })
], { root: 'brewery-root' });

const bakery = definition('bakery', 'Bakery', 'bakery-root', [
	n('bakery-root', 'A fresh dough on the bench', 'Choose dough, work the fold, score the loaf, or move to the oven preview.', [
		c('bake-select', 'Choose a dough', 'bakery-select', 'Start with a local dough selection.', '＋', 'SELECT'),
		c('bake-fold', 'Fold the dough', 'bakery-fold', 'Continue the shaping step.', '↻', 'ACTION'),
		c('bake-score', 'Score the loaf', 'bakery-score', 'Choose a simple scoring pattern.', '✳', 'ACTION'),
		c('bake-oven', 'Set the oven', 'bakery-oven', 'Preview heat and bake timing.', '♨', 'OVEN'),
		c('bake-finish', 'Preview the finish', 'bakery-finished', 'See the local result state.', '✓', 'FINISH')
	], { kind: 'menu', scene: scene('root', 'Bakery', 'A flour-dusted bench and a warm hearth anchor the work.') }),
	n('bakery-select', 'Choose the dough', 'Pick a dough profile for the local baking flow.', [
		c('dough-country', 'Country loaf', 'bakery-dough', 'Slow, sturdy, and gently tangy.', '▤', 'SOURDOUGH'),
		c('dough-seed', 'Seeded loaf', 'bakery-dough', 'A nutty crust with a little crunch.', '▤', 'GRAIN'),
		c('dough-honey', 'Honey oat', 'bakery-dough', 'Soft crumb and a warm sweetness.', '✿', 'SWEET'),
		c('dough-back', 'Back to the bench', 'bakery-root', 'Leave the dough selection for later.', '←')
	], { kind: 'activity', scene: scene('root', 'Dough selection', 'A short list keeps the next decision close to the bench.') }),
	n('bakery-dough', 'The dough is ready to work', 'The selected loaf stays in view as shaping steps become available.', [
		c('dough-fold', 'Fold the dough', 'bakery-fold', 'Build strength with a careful fold.', '↻'),
		c('dough-score', 'Score the loaf', 'bakery-score', 'Preview a cut pattern.', '✳'),
		c('dough-oven', 'Set the oven', 'bakery-oven', 'Choose the bake conditions.', '♨'),
		c('dough-adjust', 'Choose another dough', 'bakery-select', 'Swap the local selection.', '＋'),
		c('dough-finish', 'Preview the finish', 'bakery-finished', 'Show the mock result.', '✓')
	], { kind: 'inspection', scene: scene('root', 'Dough on the bench', 'The selected loaf is the visual anchor for the next actions.') }),
	n('bakery-fold', 'Fold and rest', 'Choose a simple fold preview. No real bake session is created.', [
		c('fold-gentle', 'Gentle fold', 'bakery-folded', 'Turn the dough without pressing out its air.', '↻', 'SHAPE'),
		c('fold-letter', 'Letter fold', 'bakery-folded', 'Build tidy layers.', '↻', 'SHAPE'),
		c('fold-back', 'Back to the dough', 'bakery-dough', 'Leave the dough as it is.', '←')
	], { kind: 'activity', scene: scene('root', 'Folding', 'One focused action at a time beside the bench.') }),
	n('bakery-folded', 'The dough rests', 'A local result keeps the next shaping decision close at hand.', [
		c('fold-again', 'Fold once more', 'bakery-fold', 'Continue the shaping preview.', '↻'),
		c('fold-score', 'Score the loaf', 'bakery-score', 'Move to the next step.', '✳'),
		c('fold-oven', 'Set the oven', 'bakery-oven', 'Skip ahead to heat and timing.', '♨')
	], { kind: 'result', scene: scene('root', 'Resting dough'), result: { title: 'Fold complete', detail: 'The dough is smooth and ready for the next step.', tone: 'success' } }),
	n('bakery-score', 'Score the loaf', 'Select a cut pattern for the top of the loaf.', [
		c('score-cross', 'Cross-cut', 'bakery-scored', 'A familiar pattern that opens evenly.', '✳', 'PATTERN'),
		c('score-leaf', 'Leaf pattern', 'bakery-scored', 'A quiet botanical flourish.', '✳', 'PATTERN'),
		c('score-single', 'Single slash', 'bakery-scored', 'One clean line along the crown.', '✳', 'PATTERN'),
		c('score-back', 'Back to the dough', 'bakery-dough', 'Wait before scoring.', '←')
	], { kind: 'activity', scene: scene('root', 'Scoring', 'The pattern choice appears when the loaf is ready for it.') }),
	n('bakery-scored', 'The loaf is marked', 'The scored loaf is ready for oven setup.', [
		c('score-to-oven', 'Set the oven', 'bakery-oven', 'Choose heat and timing.', '♨'),
		c('score-again', 'Change the pattern', 'bakery-score', 'Try another local scoring preview.', '✳'),
		c('score-back', 'Back to the dough', 'bakery-dough', 'Return to shaping choices.', '←')
	], { kind: 'result', scene: scene('root', 'Scored loaf'), result: { title: 'Scored', detail: 'The loaf is ready for its oven preview.', tone: 'success' } }),
	n('bakery-oven', 'Set the hearth', 'Choose the heat profile for a local bake preview.', [
		c('oven-gentle', 'Gentle heat', 'bakery-oven-ready', 'A longer, softer bake.', '♨', 'HEAT'),
		c('oven-brisk', 'Brisk heat', 'bakery-oven-ready', 'A deeper crust in less time.', '♨', 'HEAT'),
		c('oven-back', 'Back to the bench', 'bakery-dough', 'Return to shaping.', '←')
	], { kind: 'activity', scene: scene('root', 'Oven', 'The hearth is in focus while heat is being chosen.') }),
	n('bakery-oven-ready', 'The oven is ready', 'Review the local bake setup, then finish or adjust the loaf.', [
		c('oven-finish', 'Finish the loaf', 'bakery-finished', 'Show the local result.', '✓'),
		c('oven-score-again', 'Change the score', 'bakery-score', 'Return to the pattern choices.', '✳'),
		c('oven-dough', 'Return to the dough', 'bakery-dough', 'Continue shaping.', '←')
	], { kind: 'inspection', scene: scene('root', 'Ready to bake', 'A concise oven check keeps the loaf and hearth together.') }),
	n('bakery-finished', 'A loaf from the hearth', 'The baking path ends here as a mock result. Nothing was submitted to gameplay.', [
		c('bake-again', 'Start another loaf', 'bakery-select', 'Choose another dough profile.', '＋'),
		c('bake-home', 'Back to the bakery', 'bakery-root', 'Return to the workbench.', '←')
	], { kind: 'result', scene: scene('root', 'Finished loaf'), result: { title: 'Loaf complete', detail: 'A burnished crust cools beside the hearth.', tone: 'success' } })
], { root: 'bakery-root' });

const shop = definition('shop', 'Elara’s Garden Shop', 'shop-root', [
	n('shop-root', 'Visit Elara’s counter', 'Choose the kind of stock you need. Item details and the mock order appear only after a selection.', [
		c('shop-seeds', 'Seeds', 'shop-seeds', 'Browse seed stock.', '✿', 'CATEGORY'),
		c('shop-care', 'Garden Care', 'shop-care', 'Find supplies for tending the garden.', '♲', 'CATEGORY'),
		c('shop-apiary', 'Apiary', 'shop-apiary', 'Browse the apiary category.', '⌁', 'CATEGORY'),
		c('shop-stock', 'View the counter stock', 'trinkets', 'See the shop display in the scene.', '⌕', 'COUNTER')
	], { kind: 'menu', scene: scene('root', 'Elara’s shop', 'Seeds and practical garden supplies arranged around the shop counter.') }),
	n('shop-seeds', 'Seeds', 'Choose the seed stock category, then inspect the item before previewing an order.', [
		c('shop-seed-item', 'Seed packet', 'shop-item-seeds', 'A seed selection for the garden.', '✿', 'SEEDS'),
		c('seeds-back', 'Back to Elara’s counter', 'shop-root', 'Choose another category.', '←')
	], { kind: 'menu', scene: scene('root', 'Seeds', 'A category destination for garden planting stock.') }),
	n('shop-care', 'Garden Care', 'Choose a care item or the Garden expansion SKU.', [
		c('shop-soil-builder', 'Soil Builder', 'shop-item-soil-builder', 'Improve the garden soil.', '♲', 'CARE'),
		c('shop-compost', 'Compost', 'shop-item-compost', 'Add a compost blend to the garden.', '♲', 'CARE'),
		c('shop-moisture', 'Moisture', 'shop-item-moisture', 'Support moisture in a selected plot.', '⌁', 'CARE'),
		c('shop-expansion-sku', 'Garden expansion', 'shop-item-expansion', 'The garden expansion item in Garden Care.', '↗', 'EXPANSION'),
		c('care-back', 'Back to Elara’s counter', 'shop-root', 'Choose another category.', '←')
	], { kind: 'menu', scene: scene('root', 'Garden Care', 'Practical supplies and the garden expansion item share one category.') }),
	n('shop-apiary', 'Apiary', 'Review the apiary category and choose its available stock for a mock order.', [
		c('shop-apiary-item', 'Apiary stock', 'shop-item-apiary', 'Inspect the selected apiary stock item.', '⌁', 'APIARY'),
		c('apiary-back', 'Back to Elara’s counter', 'shop-root', 'Choose another category.', '←')
	], { kind: 'menu', scene: scene('root', 'Apiary', 'Apiary stock is grouped under its own shop category.') }),
	n('trinkets', 'Counter stock', 'Choose an item visible at Elara’s counter. This scene-linked list stays within the shop’s real categories.', [
		c('stock-seeds', 'Seeds', 'shop-seeds', 'Open the Seeds category.', '✿', 'CATEGORY'),
		c('stock-care', 'Garden Care', 'shop-care', 'Open the Garden Care category.', '♲', 'CATEGORY'),
		c('stock-apiary', 'Apiary', 'shop-apiary', 'Open the Apiary category.', '⌁', 'CATEGORY'),
		c('stock-back', 'Back to the shop', 'shop-root', 'Return to the counter overview.', '←')
	], { kind: 'menu', scene: scene('trinkets', 'Shop stock', 'Elara’s scene display stays central while stock categories open.') }),
	n('shop-item-seeds', 'Seed packet', 'A seed selection from Elara’s Seeds category.', [
		c('order-seeds', 'Preview mock order', 'shop-order', 'Review the selected seed stock.', '＋', 'MOCK ORDER'),
		c('seed-item-back', 'Back to Seeds', 'shop-seeds', 'Choose another seed selection.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Seeds', 'The selected stock remains linked to the counter scene.') }),
	n('shop-item-soil-builder', 'Soil Builder', 'A Garden Care item for building up the soil in a selected plot.', [
		c('order-soil-builder', 'Preview mock order', 'shop-order', 'Review Soil Builder in the order.', '＋', 'MOCK ORDER'),
		c('soil-builder-back', 'Back to Garden Care', 'shop-care', 'Compare another care item.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Soil Builder', 'A selected Garden Care item from the shop counter.') }),
	n('shop-item-compost', 'Compost', 'A Garden Care item for amending a plot.', [
		c('order-compost', 'Preview mock order', 'shop-order', 'Review Compost in the order.', '＋', 'MOCK ORDER'),
		c('compost-item-back', 'Back to Garden Care', 'shop-care', 'Compare another care item.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Compost', 'A selected Garden Care item from the shop counter.') }),
	n('shop-item-moisture', 'Moisture', 'A Garden Care item for supporting moisture in a selected plot.', [
		c('order-moisture', 'Preview mock order', 'shop-order', 'Review Moisture in the order.', '＋', 'MOCK ORDER'),
		c('moisture-item-back', 'Back to Garden Care', 'shop-care', 'Compare another care item.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Moisture', 'A selected Garden Care item from the shop counter.') }),
	n('shop-item-expansion', 'Garden expansion', 'The expansion SKU is offered within Garden Care.', [
		c('order-expansion', 'Preview mock order', 'shop-order', 'Review the Garden expansion item.', '＋', 'MOCK ORDER'),
		c('expansion-item-back', 'Back to Garden Care', 'shop-care', 'Return to the care category.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Garden expansion', 'The Garden expansion SKU is selected at the counter.') }),
	n('shop-item-apiary', 'Apiary stock', 'An item selected from the Apiary category.', [
		c('order-apiary', 'Preview mock order', 'shop-order', 'Review the selected apiary stock.', '＋', 'MOCK ORDER'),
		c('apiary-item-back', 'Back to Apiary', 'shop-apiary', 'Return to the category.', '←')
	], { kind: 'inspection', scene: scene('trinkets', 'Apiary stock', 'The selected item remains linked to the counter scene.') }),
	n('shop-order', 'Mock Order', 'Review the selected item and confirm a local mock order. No inventory, currency, or server state changes.', [
		c('order-confirm', 'Confirm mock order', 'shop-ordered', 'Show the local confirmation state.', '✓', 'CONFIRM'),
		c('order-back-care', 'Back to Garden Care', 'shop-care', 'Continue browsing shop items.', '←'),
		c('order-back-shop', 'Back to Elara’s counter', 'shop-root', 'Leave without confirming.', '←')
	], { kind: 'activity', scene: scene('trinkets', 'Mock Order', 'The selected item stays associated with the scene while the order is reviewed.') }),
	n('shop-ordered', 'Mock Order confirmed', 'The shop interaction ends with local feedback only; no order was submitted.', [
		c('order-another', 'Browse the counter', 'shop-root', 'Choose another category or item.', '←'),
		c('order-care', 'Back to Garden Care', 'shop-care', 'Continue browsing Garden Care.', '♲'),
		c('order-seeds-back', 'Back to Seeds', 'shop-seeds', 'Continue browsing seeds.', '✿'),
		c('order-apiary-back', 'Back to Apiary', 'shop-apiary', 'Continue browsing Apiary stock.', '⌁')
	], { kind: 'result', scene: scene('trinkets', 'Mock Order', 'A concise order confirmation stays inside the shop scene.'), result: { title: 'Mock order confirmed', detail: 'The selected shop item is confirmed in this local prototype only.', tone: 'success' } })
], { root: 'shop-root' });

const workflows: Record<WorkflowArea, WorkflowDefinition> = { bar, garden, shop, brewery, bakery };

/** Return the shared graph; variants A/B/C are renderer-only and do not change its transitions. */
export function getWorkflow(area: WorkflowArea): WorkflowDefinition {
	return workflows[area];
}
