import { describe, expect, it } from 'vitest'
import { maskText } from '../src/utils/mask.js'

describe('conversation display privacy', () => {
  it('masks phone and identity numbers while preserving ordinary message text', () => {
    expect(maskText('电话13900000000，证件110101199001011234')).toBe(
      '电话139****0000，证件110101********1234'
    )
  })

  it('does not interpret digits inside a longer number as a phone number', () => {
    expect(maskText('流水号1139000000009')).toBe('流水号1139000000009')
  })
})
