<script lang="ts">
	import type { TavernCardKind } from './card-types';

	let { kind, seed }: { kind: TavernCardKind; seed: string } = $props();
	const prefix = $derived(`tavern-art-${kind}-${hashSeed(seed)}`);

	function hashSeed(value: string) {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index += 1) {
			hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
		}
		return (hash >>> 0).toString(36);
	}
</script>

<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">
	<defs>
		<linearGradient id={`${prefix}-field`} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#574125" />
			<stop offset="0.56" stop-color="#2b2117" />
			<stop offset="1" stop-color="#17140f" />
		</linearGradient>
		<linearGradient id={`${prefix}-gold`} x1="0" y1="0" x2="0.9" y2="1">
			<stop offset="0" stop-color="#f6df9d" />
			<stop offset="0.48" stop-color="#c89543" />
			<stop offset="1" stop-color="#785128" />
		</linearGradient>
		<linearGradient id={`${prefix}-glass`} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#cae1d1" stop-opacity="0.9" />
			<stop offset="0.5" stop-color="#4c8d83" stop-opacity="0.62" />
			<stop offset="1" stop-color="#243f43" stop-opacity="0.9" />
		</linearGradient>
		<linearGradient id={`${prefix}-rose`} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#f3b8a0" />
			<stop offset="0.5" stop-color="#bd5851" />
			<stop offset="1" stop-color="#713739" />
		</linearGradient>
		<linearGradient id={`${prefix}-ale`} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#f7d276" />
			<stop offset="0.52" stop-color="#bf792f" />
			<stop offset="1" stop-color="#75401f" />
		</linearGradient>
		<linearGradient id={`${prefix}-crust`} x1="0" y1="0" x2="0.9" y2="1">
			<stop offset="0" stop-color="#f4c77a" />
			<stop offset="0.55" stop-color="#c77d3d" />
			<stop offset="1" stop-color="#75402a" />
		</linearGradient>
	</defs>

	<rect x="4" y="4" width="88" height="88" rx="17" fill={`url(#${prefix}-field)`} />
	<rect x="7" y="7" width="82" height="82" rx="14" fill="none" stroke={`url(#${prefix}-gold)`} stroke-opacity="0.72" stroke-width="1.5" />
	<path d="M13 24c11-11 25-15 40-14M83 72c-8 10-19 16-34 18" fill="none" stroke="#fff0c0" stroke-opacity="0.12" stroke-width="2" />

	{#if kind === 'charm'}
		<circle cx="48" cy="49" r="29" fill="#20170e" stroke={`url(#${prefix}-gold)`} stroke-width="4" />
		<circle cx="48" cy="49" r="22" fill="#51381b" stroke="#eed18a" stroke-opacity="0.62" />
		<path d="M24 31 19 21l12 4m39 6 5-10-12 4" fill="#d4aa59" stroke="#f5d995" stroke-width="1.5" stroke-linejoin="round" />
		<path d="M27 52c7-8 14-14 23-12l8 5 11 2-7 6-5 12-9-5-10 4-2-8-8 2z" fill="#18140f" stroke="#c89a48" stroke-width="1.3" stroke-linejoin="round" />
		<path d="M40 47c7-5 13-3 18 1l-8 1-5 8-7-3z" fill="#a87935" />
		<path d="m68 47 10-2-7 7-6-1" fill="#e0bc70" />
		<circle cx="60" cy="46" r="1.8" fill="#ffe9a8" />
		<path d="m34 60-7 7m17-2-3 9m15-8 4 7" stroke="#d9b362" stroke-width="1.6" stroke-linecap="round" />
	{:else if kind === 'insight'}
		<path d="M48 13v8m-25 5 6 5m38-5-6 5M18 48h8m44 0h8" stroke="#9fc6bb" stroke-width="2" stroke-linecap="round" opacity="0.8" />
		<path d="M36 30v-5c0-7 5-12 12-12s12 5 12 12v5l7 10v25H29V40z" fill="#342819" stroke={`url(#${prefix}-gold)`} stroke-width="3" stroke-linejoin="round" />
		<path d="M37 39h22v21H37z" fill={`url(#${prefix}-glass)`} stroke="#c9d9c0" stroke-opacity="0.82" stroke-width="1.5" />
		<path d="M48 42c-7 7-6 11 0 15 6-4 7-8 0-15Z" fill="#f3d27b" />
		<path d="M35 65h26l5 8H30z" fill={`url(#${prefix}-gold)`} stroke="#f3dc9d" stroke-width="1.3" stroke-linejoin="round" />
		<path d="M34 39h28m-25 24h21" stroke="#eed597" stroke-width="2" stroke-linecap="round" />
	{:else if kind === 'flirt'}
		<path d="M49 83c0-20 3-34 11-49" fill="none" stroke="#77905b" stroke-width="3" stroke-linecap="round" />
		<path d="M50 68c-11-12-20-8-19-2 1 7 12 9 19 8m8-20c9-11 17-7 16-1-1 7-10 10-17 9" fill="#567149" stroke="#c0bd7c" stroke-width="1.4" stroke-linejoin="round" />
		<path d="M48 38c-7-11 2-20 10-14 5-12 19-7 16 4 11 5 7 17-4 17-2 10-15 9-16 0-10 5-16-3-6-7Z" fill={`url(#${prefix}-rose)`} stroke="#f0c08e" stroke-width="1.8" stroke-linejoin="round" />
		<path d="M52 38c4-7 12-8 17-5-1 6-6 11-13 11-4-1-6-3-4-6Z" fill="#f0c38b" stroke="#a64744" stroke-width="1.3" />
		<path d="M39 83h23" stroke="#d1aa62" stroke-width="2" stroke-linecap="round" />
	{:else if kind === 'rumor'}
		<path d="M18 71c14-3 24-2 34 0 9 2 17 1 27-4" fill="none" stroke={`url(#${prefix}-gold)`} stroke-width="3" stroke-linecap="round" />
		<path d="M29 59c2-9 9-15 17-15 5 0 8 3 11 6l8 1-5 5-5 10-6-5-8 2-2-6-9 3z" fill="#17140f" stroke="#c8ad73" stroke-width="1.5" stroke-linejoin="round" />
		<path d="M57 61c2-8 8-13 15-12 4 0 7 2 9 5l7 1-5 4-4 8-6-4-6 2-2-5-8 2z" fill="#292016" stroke="#c8ad73" stroke-width="1.5" stroke-linejoin="round" />
		<path d="m64 51 7-3-5 6m-23-4 8-3-5 6" fill="#d0ae69" />
		<circle cx="51" cy="50" r="1.4" fill="#f3dfa8" />
		<circle cx="78" cy="52" r="1.4" fill="#f3dfa8" />
		<path d="M27 32c5-5 10-5 15 0m20-8c5-5 10-5 15 0" fill="none" stroke="#c4a66b" stroke-width="2" stroke-linecap="round" opacity="0.85" />
		<path d="M34 24c-3-3-5-3-8-1m44-6c3-3 5-3 8-1" fill="none" stroke="#e6c886" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />
	{:else if kind === 'food'}
		<path d="M23 67c8-9 42-11 52-1l-4 10c-13 8-35 8-47-1z" fill="#7d502f" stroke="#e7c381" stroke-width="2" />
		<ellipse cx="48" cy="67" rx="28" ry="9" fill="#dec080" stroke="#f0dba1" stroke-width="1.6" />
		<path d="M28 62c0-14 8-25 20-25 12 0 20 11 20 25-10 8-30 8-40 0Z" fill={`url(#${prefix}-crust)`} stroke="#f0c985" stroke-width="2" />
		<path d="M40 42c-3 5-4 10-3 16m12-19c-3 5-4 11-3 17m13-13c-2 4-3 8-2 12" fill="none" stroke="#f8d9a0" stroke-width="2.4" stroke-linecap="round" />
		<path d="M34 28c-4-5 4-8 1-13m14 13c-4-5 4-8 1-13m13 14c-4-5 4-8 1-13" fill="none" stroke="#e0a458" stroke-width="2" stroke-linecap="round" opacity="0.85" />
	{:else}
		<path d="M65 29h7c8 0 12 6 12 14 0 9-6 16-15 17h-3" fill="none" stroke={`url(#${prefix}-gold)`} stroke-width="6" stroke-linecap="round" />
		<path d="M25 26h44l-4 52c-1 6-6 9-13 9H42c-8 0-12-3-13-9z" fill={`url(#${prefix}-ale)`} stroke="#f3d895" stroke-width="2.5" stroke-linejoin="round" />
		<path d="M27 32h40l-2 9H28z" fill="#f0d79a" />
		<path d="M29 34c3-8 11-10 16-5 4-9 15-8 18 1 6-1 9 5 6 9H30c-2-1-3-3-1-5Z" fill="#f7e6bf" stroke="#c59a55" stroke-width="1.6" stroke-linejoin="round" />
		<path d="M30 71h36m-37 6h36" stroke="#dfbb6a" stroke-width="2" stroke-linecap="round" />
		<circle cx="40" cy="53" r="2" fill="#ffe5a1" opacity="0.75" />
		<circle cx="53" cy="62" r="1.6" fill="#ffe5a1" opacity="0.72" />
	{/if}
</svg>

<style>
	svg { display: block; width: 100%; height: 100%; }
</style>
