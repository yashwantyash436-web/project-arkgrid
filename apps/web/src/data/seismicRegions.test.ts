import { describe, expect, it } from 'vitest'
import { isInSeismicRegion, seismicRegions } from './seismicRegions'

describe('monitored seismic regions', () => {
  it('defines all seven monitoring regions with attributable references', () => {
    expect(seismicRegions.map(region => region.id)).toEqual([
      'japan', 'nepal', 'indonesia', 'turkiye', 'chile', 'western-us', 'new-zealand',
    ])
    expect(seismicRegions.every(region => region.sourceUrl.startsWith('https://'))).toBe(true)
  })

  it('filters using inclusive approximate bounds and handles New Zealand across the antimeridian', () => {
    const newZealand = seismicRegions.find(region => region.id === 'new-zealand')
    const nepal = seismicRegions.find(region => region.id === 'nepal')
    expect(newZealand).toBeDefined()
    expect(nepal).toBeDefined()
    if (!newZealand || !nepal) return

    expect(isInSeismicRegion(-41, 174, newZealand)).toBe(true)
    expect(isInSeismicRegion(-41, -175, newZealand)).toBe(true)
    expect(isInSeismicRegion(-41, 150, newZealand)).toBe(false)
    expect(isInSeismicRegion(28, 85, nepal)).toBe(true)
    expect(isInSeismicRegion(28, 95, nepal)).toBe(false)
    expect(isInSeismicRegion(Number.NaN, 85, nepal)).toBe(false)
  })
})
