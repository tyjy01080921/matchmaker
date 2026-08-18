import { describe, expect, it } from 'vitest'
import { parseBulkPlayerDrafts } from './playerInput'

describe('parseBulkPlayerDrafts', () => {
  it('keeps the first token as the participant name even when it looks numeric', () => {
    const [player] = parseBulkPlayerDrafts('40 A 남 30대')

    expect(player).toMatchObject({
      name: '40',
      level: 'A',
      gender: 'male',
      ageGroup: '30대',
    })
  })

  it('ignores numbered-list prefixes and recognizes slash-separated participant details', () => {
    const players = parseBulkPlayerDrafts(`
1. 김학관 / 남 / A
2. 김시현 / 남 / D
3. 윤남기 / 남 / D
4. 차승호 / 남 / D
5. 윤현우 / 남 / D
6. 김성민 / 남 / A
7. 박병은 / 남 / A
8. 이근수 / 남 / A
9. 조건희 / 남 / A
10. 서영완 / 남 / A
11. 김형미 / 여 / A
12. 곽영진 / 여 / A
13. 김연진 / 여 / B
14. 전미애 / 여 / A
15. 김미진 / 여 / A
16. 백미나 / 여 / A
17. 김혜경 / 여 / A
18. 정미경 / 여 / D
19. 장순자 / 여 / A
20. 조유재 / 여 / D
21. 김경복 / 여 / A
22. 최윤수 / 남 / A
23. 박준성 / 남 / D
24. 이상태 / 남 / D
25. 서영석 / 남 / A
26. 박지훈/ 남 / B
27. 김태은/ 여 / D
28. 더쎈1/ 남/ A
29. 더쎈2/남/A
30. 이희태/남/B
31. 고성현/스페셜
32. 고수지/스페셜
    `)

    expect(
      players.map(({ name, gender, level, isGuest }) => [name, gender, level, isGuest]),
    ).toEqual([
      ['김학관', 'male', 'A', false],
      ['김시현', 'male', 'D', false],
      ['윤남기', 'male', 'D', false],
      ['차승호', 'male', 'D', false],
      ['윤현우', 'male', 'D', false],
      ['김성민', 'male', 'A', false],
      ['박병은', 'male', 'A', false],
      ['이근수', 'male', 'A', false],
      ['조건희', 'male', 'A', false],
      ['서영완', 'male', 'A', false],
      ['김형미', 'female', 'A', false],
      ['곽영진', 'female', 'A', false],
      ['김연진', 'female', 'B', false],
      ['전미애', 'female', 'A', false],
      ['김미진', 'female', 'A', false],
      ['백미나', 'female', 'A', false],
      ['김혜경', 'female', 'A', false],
      ['정미경', 'female', 'D', false],
      ['장순자', 'female', 'A', false],
      ['조유재', 'female', 'D', false],
      ['김경복', 'female', 'A', false],
      ['최윤수', 'male', 'A', false],
      ['박준성', 'male', 'D', false],
      ['이상태', 'male', 'D', false],
      ['서영석', 'male', 'A', false],
      ['박지훈', 'male', 'B', false],
      ['김태은', 'female', 'D', false],
      ['더쎈1', 'male', 'A', false],
      ['더쎈2', 'male', 'A', false],
      ['이희태', 'male', 'B', false],
      ['고성현', 'none', '스페셜', true],
      ['고수지', 'none', '스페셜', true],
    ])
  })

  it('classifies level, gender, and age after the name in any order', () => {
    const players = parseBulkPlayerDrafts('박태호 남 30 B\n최수빈 40 여 A')

    expect(players).toEqual([
      expect.objectContaining({
        name: '박태호',
        level: 'B',
        gender: 'male',
        ageGroup: '30대',
      }),
      expect.objectContaining({
        name: '최수빈',
        level: 'A',
        gender: 'female',
        ageGroup: '40대',
      }),
    ])
  })

  it('recognizes numeric age tokens without treating them as levels', () => {
    const [player] = parseBulkPlayerDrafts('김민수 40 남')

    expect(player).toMatchObject({
      name: '김민수',
      level: 'O',
      gender: 'male',
      ageGroup: '40대',
    })
  })

  it('recognizes E as a regular level', () => {
    const [player] = parseBulkPlayerDrafts('이하늘 E 여 55대이상')

    expect(player).toMatchObject({
      name: '이하늘',
      level: 'E',
      gender: 'female',
      ageGroup: '55대이상',
    })
  })

  it('recognizes game and wait flexibility tokens', () => {
    const [player] = parseBulkPlayerDrafts('홍길동 B 경기양보 대기양보')

    expect(player).toMatchObject({
      name: '홍길동',
      gameCountFlexible: true,
      waitTimeFlexible: true,
    })
  })
})
