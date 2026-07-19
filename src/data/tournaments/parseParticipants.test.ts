import { describe, expect, it } from 'vitest'

import { parseParticipantList } from './parseParticipants'

describe('parseParticipantList — the shapes lists actually arrive in', () => {
  it('parses a plain list of pairs', () => {
    const { participants } = parseParticipantList(
      ['Juan y María', 'Pedro y Ana', 'Carlos y Laura'].join('\n'),
    )

    expect(participants).toHaveLength(3)
    expect(participants[0]?.displayName).toBe('Juan y María')
    expect(participants[0]?.memberNames).toEqual(['Juan', 'María'])
    expect(participants[0]?.kind).toBe('pair')
  })

  it('ignores blank lines and stray whitespace', () => {
    const { participants } = parseParticipantList(
      ['', '  Juan y María  ', '', '\t', 'Pedro y Ana', ''].join('\n'),
    )

    expect(participants).toHaveLength(2)
    expect(participants[0]?.displayName).toBe('Juan y María')
  })

  it('collapses runs of whitespace inside a name', () => {
    const { participants } = parseParticipantList('Juan    y     María')
    expect(participants[0]?.displayName).toBe('Juan y María')
  })

  it('reports the source line, so a problem can be pointed at', () => {
    const { participants } = parseParticipantList(['', 'Juan y María', '', 'Pedro y Ana'].join('\n'))

    expect(participants[0]?.line).toBe(2)
    expect(participants[1]?.line).toBe(4)
  })
})

describe('parseParticipantList — member separators', () => {
  it.each([
    ['Juan y María', ['Juan', 'María']],
    ['María e Isabel', ['María', 'Isabel']],
    ['Juan / María', ['Juan', 'María']],
    ['Juan/María', ['Juan', 'María']],
    ['Juan & María', ['Juan', 'María']],
    ['Juan + María', ['Juan', 'María']],
    ['Juan, María', ['Juan', 'María']],
  ])('splits %s', (input, expected) => {
    const { participants } = parseParticipantList(input)
    expect(participants[0]?.memberNames).toEqual(expected)
  })

  it('does not tear a name that merely contains the letter y', () => {
    // Word separators require surrounding whitespace. Without that, "Yolanda"
    // and "Maryse" would each lose half of themselves.
    const { participants } = parseParticipantList('Yolanda y Maryse')
    expect(participants[0]?.memberNames).toEqual(['Yolanda', 'Maryse'])
  })

  it('treats a single name as a player', () => {
    const { participants } = parseParticipantList('Miguel Ángel')
    expect(participants[0]?.memberNames).toEqual(['Miguel Ángel'])
    expect(participants[0]?.kind).toBe('player')
  })

  it('treats three or more as a team', () => {
    const { participants } = parseParticipantList('Ana, Luis, Marta, Sofía')
    expect(participants[0]?.kind).toBe('team')
    expect(participants[0]?.memberNames).toHaveLength(4)
  })

  it('lets the caller override the inferred kind', () => {
    // A padel tournament is pairs whether or not both names were written.
    const { participants } = parseParticipantList('Juan', { kind: 'pair' })
    expect(participants[0]?.kind).toBe('pair')
  })
})

describe('parseParticipantList — seeds', () => {
  it.each([
    ['1. Juan y María', 1],
    ['2) Pedro y Ana', 2],
    ['3 - Carlos y Laura', 3],
    ['12. Doce y Doce', 12],
  ])('reads a punctuated seed from %s', (input, seed) => {
    const { participants } = parseParticipantList(input)
    expect(participants[0]?.seed).toBe(seed)
  })

  it('strips the seed from the display name', () => {
    const { participants } = parseParticipantList('1. Juan y María')
    expect(participants[0]?.displayName).toBe('Juan y María')
    expect(participants[0]?.memberNames).toEqual(['Juan', 'María'])
  })

  it('does NOT read a bare leading number as a seed', () => {
    // "4 Estaciones" is a club named after the seasons, not the fourth seed.
    // Inventing a seed silently rearranges the draw, and the organiser has no
    // reason to go looking for it. Keeping the number visible in the name is
    // wrong in a way they can see and fix.
    const { participants } = parseParticipantList('4 Estaciones')
    expect(participants[0]?.seed).toBeNull()
    expect(participants[0]?.displayName).toBe('4 Estaciones')
  })

  it('leaves unseeded entries null', () => {
    const { participants } = parseParticipantList(['1. Juan y María', 'Pedro y Ana'].join('\n'))
    expect(participants[0]?.seed).toBe(1)
    expect(participants[1]?.seed).toBeNull()
  })

  it('reports a seed used twice', () => {
    // Two number ones means the bracket order between them is arbitrary, which
    // is exactly the kind of thing that gets disputed afterwards.
    const { repeatedSeeds } = parseParticipantList(
      ['1. Juan y María', '1. Pedro y Ana', '2. Carlos y Laura'].join('\n'),
    )
    expect(repeatedSeeds).toEqual([1])
  })

  it('reports nothing when seeds are unique', () => {
    const { repeatedSeeds } = parseParticipantList(
      ['1. Juan y María', '2. Pedro y Ana'].join('\n'),
    )
    expect(repeatedSeeds).toEqual([])
  })
})

describe('parseParticipantList — duplicates', () => {
  it('imports a duplicate once and reports it', () => {
    const { participants, duplicates } = parseParticipantList(
      ['Juan y María', 'Pedro y Ana', 'Juan y María'].join('\n'),
    )

    expect(participants).toHaveLength(2)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.displayName).toBe('Juan y María')
    expect(duplicates[0]?.lines).toEqual([1, 3])
  })

  it('matches across differing accents', () => {
    // The same pair really does get typed "María" once and "Maria" the next
    // time. Importing both creates a phantom entrant, noticed only when
    // somebody fails to turn up for a match that was never theirs.
    const { participants, duplicates } = parseParticipantList(
      ['Juan y María', 'Juan y Maria'].join('\n'),
    )

    expect(participants).toHaveLength(1)
    expect(duplicates[0]?.lines).toEqual([1, 2])
  })

  it('matches across differing case', () => {
    const { participants } = parseParticipantList(['Juan y María', 'JUAN Y MARÍA'].join('\n'))
    expect(participants).toHaveLength(1)
  })

  it('keeps the first spelling', () => {
    const { participants } = parseParticipantList(['Juan y María', 'juan y maria'].join('\n'))
    expect(participants[0]?.displayName).toBe('Juan y María')
  })

  it('does not treat different pairs as duplicates', () => {
    const { participants, duplicates } = parseParticipantList(
      ['Juan y María', 'Juan y Ana', 'Pedro y María'].join('\n'),
    )
    expect(participants).toHaveLength(3)
    expect(duplicates).toEqual([])
  })
})

describe('parseParticipantList — edge cases', () => {
  it('returns empty for empty input', () => {
    const result = parseParticipantList('')
    expect(result.participants).toEqual([])
    expect(result.duplicates).toEqual([])
    expect(result.repeatedSeeds).toEqual([])
  })

  it('returns empty for whitespace only', () => {
    expect(parseParticipantList('   \n\n \t \n').participants).toEqual([])
  })

  it('handles Windows line endings', () => {
    // A list pasted out of Excel on Windows arrives with CRLF.
    const { participants } = parseParticipantList('Juan y María\r\nPedro y Ana')
    expect(participants).toHaveLength(2)
    expect(participants[0]?.displayName).toBe('Juan y María')
  })

  it.each([['1.'], ['-'], ['---'], ['2)'], ['•'], ['   .   ']])(
    'skips the non-name fragment %s',
    (junk) => {
      // Pasted lists are full of these. Without a guard, "1." on its own line
      // becomes a participant called "1." and takes a place in the draw.
      const { participants } = parseParticipantList([junk, 'Juan y María'].join('\n'))
      expect(participants).toHaveLength(1)
      expect(participants[0]?.displayName).toBe('Juan y María')
    },
  )

  it('keeps a name that merely contains digits', () => {
    // The guard is "contains no letter", not "contains a digit" — a club named
    // after a year or a number is a real thing.
    const { participants } = parseParticipantList('Padel 2000')
    expect(participants[0]?.displayName).toBe('Padel 2000')
  })

  it('parses a realistic pasted list end to end', () => {
    const pasted = [
      '1. Juan y María',
      '2. Pedro / Ana',
      '',
      '3 - Carlos & Laura',
      'Miguel Ángel y Sofía',
      'JUAN Y MARIA',
      '4 Estaciones',
    ].join('\r\n')

    const { participants, duplicates, repeatedSeeds } = parseParticipantList(pasted)

    expect(participants.map((p) => p.displayName)).toEqual([
      'Juan y María',
      'Pedro / Ana',
      'Carlos & Laura',
      'Miguel Ángel y Sofía',
      '4 Estaciones',
    ])
    expect(participants.map((p) => p.seed)).toEqual([1, 2, 3, null, null])
    expect(duplicates).toHaveLength(1)
    expect(repeatedSeeds).toEqual([])
  })
})
