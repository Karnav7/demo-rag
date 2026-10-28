import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Architecture } from './Architecture'
import { Guide } from './Guide'
import { CHAT_CONTRACT_SOURCE } from './contract'
import { STAGE_TITLES } from '../../engine/pipeline'

const mount = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('explainer pages', () => {
  it('routes render headings', () => {
    const a = mount(<Architecture />)
    expect(screen.getByRole('heading', { level: 1, name: 'Hybrid Graph-RAG, end to end' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /why hybrid/i })).toBeInTheDocument()
    expect(screen.getByText(/Fictional data for demonstration\. Not financial or legal advice\./)).toBeInTheDocument()
    a.unmount()
    mount(<Guide />)
    expect(screen.getByRole('heading', { level: 1, name: 'Every feature explained' })).toBeInTheDocument()
    expect(screen.getByText(/Fictional data for demonstration\. Not financial or legal advice\./)).toBeInTheDocument()
  })

  it('guide TOC lists every section id present on the page', () => {
    const { container } = mount(<Guide />)
    const toc = screen.getByRole('navigation', { name: 'On this page' })
    const hrefs = within(toc).getAllByRole('link').map((l) => l.getAttribute('href')!.replace(/^.*#/, ''))
    const ids = [...container.querySelectorAll('.page__body > section[id]')].map((s) => s.id)
    expect(ids.length).toBeGreaterThan(8)
    expect(hrefs).toEqual(ids)
  })

  it('architecture shows the ChatEvent type names stage, token, done, error', () => {
    mount(<Architecture />)
    const blocks = screen.getAllByRole('region', { name: /code/i }).map((b) => b.textContent).join('\n')
    for (const t of ['stage', 'token', 'done', 'error']) expect(blocks).toContain(`type: '${t}'`)
    expect(blocks).toContain('interface ChatRequest')
    expect(blocks).toContain('type ChatEvent')
  })

  it('contract source comes from types.ts and the pipeline stages are listed', () => {
    expect(CHAT_CONTRACT_SOURCE).toMatch(/interface ChatRequest/)
    mount(<Architecture />)
    for (const t of Object.values(STAGE_TITLES)) expect(screen.getByText(t)).toBeInTheDocument()
  })

  it('guide shows real emitted Cypher', () => {
    mount(<Guide />)
    expect(screen.getAllByText(/apoc\.path\.subgraphAll/).length).toBeGreaterThan(0)
  })
})
