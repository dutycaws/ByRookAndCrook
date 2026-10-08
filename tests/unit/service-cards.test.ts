import {describe,it,expect} from 'vitest';
import {serviceCardStacks} from '../../src/lib/game/service-cards';
import type {FinishedServiceItem} from '../../src/lib/game/serving';

const item:FinishedServiceItem={id:'one',kind:'food',name:'Fennel Bread',productKey:'herb-loaf',ingredientType:'fennel',ingredientName:'Fennel',qualityIndex:4};
describe('inventory-derived service hand',()=>{
 it('stacks recipe, ingredient type and final quality while preserving exact unit identities',()=>{
  const units=[{...item,batchId:'batch-a',sourceQuality:1,createdAt:'yesterday'}, {...item,id:'two',batchId:'batch-b',sourceQuality:6,createdAt:'today'}];
  const [stack]=serviceCardStacks(units);
  expect(stack).toMatchObject({quantity:2,itemIds:['one','two'],name:'Fennel Bread'});
  expect(stack.key).toBe(JSON.stringify(['food','herb-loaf','fennel',4]));
  expect(stack).not.toHaveProperty('sourceQuality');
  expect(stack).not.toHaveProperty('batchId');
  expect(serviceCardStacks([item,item])[0].quantity).toBe(1);
 });
 it('does not merge kinds, products, ingredients or final qualities',()=>{
  expect(serviceCardStacks([item,{...item,id:'two',kind:'beverage'}, {...item,id:'three',productKey:'other-recipe'},{...item,id:'four',ingredientType:'mint'}, {...item,id:'five',qualityIndex:5}])).toHaveLength(5);
 });
 it('reflects depletion and newly crafted inventory without owning a card resource',()=>{
  expect(serviceCardStacks([])).toEqual([]);
  expect(serviceCardStacks([item,{...item,id:'new'}])[0].itemIds).toEqual(['one','new']);
  expect(serviceCardStacks([{...item,id:'new'}])[0].quantity).toBe(1);
 });
});
