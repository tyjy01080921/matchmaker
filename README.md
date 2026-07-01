# 배드민턴 대진표 생성기

아임웹 자사몰에서 링크로 연결해 사용할 수 있는 브라우저용 배드민턴 복식 대진표 생성기입니다.

## 주요 기능

- 참가자 참석 여부, A-D 레벨, 성별, 연령대 관리
- 고성현, 신백철 같은 스페셜 슬롯 관리
- 스페셜 매칭 대상자 1게임 우선 배정
- 비슷한 실력 중심의 복식 대진 생성
- 같은 파트너/상대 반복 최소화
- 쉬는 사람 균등 배정
- 경기 결과 입력
- 참가자별 승패, 승률, 득실 통계
- 참가자 일괄 입력
- 링크 복사
- 브라우저 자동 저장

## 개발

```bash
npm install
npm run dev
```

## 확인

```bash
npm test
npm run lint
npm run build
```

## Cloudflare Pages

Cloudflare Pages에서 GitHub 저장소를 연결한 뒤 아래 값으로 배포합니다.

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

배포 후 생성된 `pages.dev` 링크를 아임웹 메뉴나 버튼에 연결하면 됩니다.

## 아임웹 연결

가장 안정적인 방식은 외부 링크 연결입니다.

```text
메뉴명: 대진표 생성기
연결 URL: https://your-project.pages.dev
```

자사몰 페이지 안에 넣고 싶으면 HTML 코드 영역에 iframe을 사용할 수 있습니다.

```html
<iframe
  src="https://your-project.pages.dev"
  style="width:100%; height:760px; border:0;"
  allow="clipboard-write"
></iframe>
```
