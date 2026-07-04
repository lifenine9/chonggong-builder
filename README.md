# 총공빌더 모바일 v31 Stable Final

## v31 반영 사항

- 더 보기 기능 제거
- 멜론 자동완성 API 10개 결과만 사용
- HTML 파싱 제거
- SID+ 검색 안정화
  - 2글자 이상부터 검색
  - 500ms debounce
  - 이전 요청 취소
  - 마지막 결과만 표시
- 곡 선택 시 Melon SID만 자동 입력
- Genie/Bugs SID 칸은 유지
- Genie/Bugs Check 버튼은 SID가 있으면 상세 페이지, 없으면 검색 페이지 열기
- Firebase 완전 제거
- 최근검색 없음

## 로컬 테스트

```bash
vercel dev
```

접속:

```text
http://localhost:3000
```
