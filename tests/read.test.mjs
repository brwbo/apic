import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillTemplate, sameOrigin, relaxReadSchema } from '../src/replay-read.js'

test('read URL templates preserve path separators but encode values', () => {
  assert.equal(
    fillTemplate('https://deliveroo.co.uk/restaurants/{area}?category={category}', { area: 'london/shoreditch', category: 'thai food' }),
    'https://deliveroo.co.uk/restaurants/london/shoreditch?category=thai%20food',
  )
})

test('a linked detail page keeps its absolute URL for same-origin validation', () => {
  assert.equal(
    fillTemplate('{url}', { url: 'https://deliveroo.co.uk/menu/London/example?day=today' }),
    'https://deliveroo.co.uk/menu/London/example?day=today',
  )
})

test('a compiled consumer API never follows an agent-supplied off-site URL', () => {
  assert.equal(sameOrigin('https://deliveroo.co.uk/menu/london/x', 'https://deliveroo.co.uk'), true)
  assert.equal(sameOrigin('https://evil.example/menu', 'https://deliveroo.co.uk'), false)
  assert.equal(sameOrigin('not a url', 'https://deliveroo.co.uk'), false)
})

test('sparse card fields become optional instead of suppressing a usable listing', () => {
  const tool = {
    rowSchema: { properties: { name: {}, price: {}, description: {} }, required: ['name', 'price'] },
    recipe: { fields: [{ name: 'name' }, { name: 'price' }, { name: 'description' }] },
  }
  assert.equal(relaxReadSchema(tool, { rows: [{ name: 'Burger', price: '', description: 'Good' }, { name: 'Fries', price: '', description: '' }] }), true)
  assert.deepEqual(tool.rowSchema.required, ['name'])
  assert.deepEqual(Object.keys(tool.rowSchema.properties), ['name', 'description'])
  assert.deepEqual(tool.recipe.fields.map((f) => f.name), ['name', 'description'])
})
