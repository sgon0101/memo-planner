import type { Metadata } from 'next'
import Link from 'next/link'
import PublicShell, { PolicyArticle } from '@/components/public/PublicShell'
import { CONTACT_EMAIL, POLICY_EFFECTIVE_DATE, PRIVACY_OFFICER, SITE_NAME } from '@/lib/site'

/**
 * 개인정보 처리방침 (2026-11-07). 실제 코드 동작 기준으로 작성 — 바꾸면 이 문서도 같이 고친다.
 * 근거: 외부 호출(Anthropic·OpenAI·Sentry·googleapis·R2·web-push), Supabase 리전 ap-southeast-1,
 * 휴지통 30일(cron/cleanup-trash), 계정 삭제(api/account/delete), 토큰 암호화(lib/crypto/tokenCipher).
 */

export const metadata: Metadata = {
  title: `개인정보 처리방침 | ${SITE_NAME}`,
  description: `${SITE_NAME}가 어떤 개인정보를 왜 처리하고 어떻게 보호하는지 안내합니다.`,
  alternates: { canonical: '/privacy' },
}

const VENDORS: { name: string; country: string; items: string; purpose: string }[] = [
  { name: 'Supabase, Inc.', country: '싱가포르 (AWS 아시아·태평양 리전)', items: '계정 정보, 작성한 콘텐츠, 이용 기록, 연동 정보(암호화)', purpose: '데이터베이스·로그인·인증 메일 발송' },
  { name: 'Cloudflare, Inc. (R2)', country: '미국 등 Cloudflare 데이터센터', items: '첨부한 이미지·PDF 파일', purpose: '첨부 파일 저장' },
  { name: 'Vercel Inc.', country: '미국 등', items: '서비스 이용 중 오가는 요청 정보, 접속 기록', purpose: '웹 서비스 호스팅' },
  { name: 'Anthropic, PBC', country: '미국', items: 'AI 기능을 쓸 때 해당 메모·첨부 파일 내용과 질문', purpose: 'AI 요약·분석·대화' },
  { name: 'OpenAI, L.L.C.', country: '미국', items: '메모 제목·본문 텍스트', purpose: '메모 검색·연결 추천용 임베딩 생성' },
  { name: 'Google LLC', country: '미국 등', items: 'Google 로그인 정보, (연결 시) Drive 백업 파일·Calendar에 추가하는 일정', purpose: 'Google 로그인, 선택한 백업·캘린더 동기화' },
  { name: 'Functional Software, Inc. (Sentry)', country: '미국', items: '오류 내용, 발생 화면 주소, 브라우저·기기 정보', purpose: '오류 확인과 해결' },
  { name: '웹 푸시 서비스 (브라우저 제공업체: Google, Apple, Mozilla 등)', country: '미국 등', items: '알림을 켠 경우 알림 내용(플랜 제목·시각)', purpose: '플랜 알림 전송' },
]

export default function PrivacyPage() {
  return (
    <PublicShell>
      <PolicyArticle title="개인정보 처리방침" effective={POLICY_EFFECTIVE_DATE}>
        <p>
          {SITE_NAME}(이하 ‘서비스’)는 이용자의 개인정보를 소중히 다루며, 「개인정보 보호법」 등 관련 법령을 지킵니다.
          이 처리방침은 서비스가 어떤 개인정보를 왜 처리하고, 어떻게 보호하며, 이용자가 어떤 권리를 가지는지 안내합니다.
        </p>

        <section>
          <h2>1. 처리하는 개인정보와 수집 방법</h2>
          <h3>계정 정보</h3>
          <ul>
            <li>이메일로 가입: 이메일 주소, 비밀번호(복원할 수 없는 방식으로 변환해 저장하므로 운영자도 원문을 볼 수 없어요)</li>
            <li>Google로 가입·로그인: 이름, 이메일 주소, 프로필 사진, Google 계정 식별자</li>
          </ul>
          <h3>이용자가 직접 작성하거나 올린 콘텐츠</h3>
          <ul>
            <li>메모(제목·본문·위키·태그), 폴더, 플랜과 일정, 하루 마감 기록과 일지, AI 대화 내용</li>
            <li>첨부한 이미지·PDF 파일과, 이를 요약할 때 만든 분석 결과</li>
          </ul>
          <h3>선택 기능을 켠 경우</h3>
          <ul>
            <li>Google Drive·Calendar 연결: 연결 권한 토큰(암호화하여 저장)과 마지막 백업·동기화 시각</li>
            <li>알림: 브라우저 푸시 구독 정보(알림을 받을 주소와 키)</li>
          </ul>
          <h3>서비스 이용 중 자동으로 생기는 정보</h3>
          <ul>
            <li>이용 기록: 앱을 연 날짜, 메모·플랜 작성 등 기능별 횟수 — <strong>메모와 플랜의 내용은 포함하지 않아요</strong></li>
            <li>AI 기능 사용량(일별 호출 횟수), 오류 기록(오류 내용, 화면 주소, 브라우저·기기 정보)</li>
          </ul>
          <p className="mt-3">광고 식별자, 위치 정보, 연락처는 수집하지 않습니다.</p>
        </section>

        <section>
          <h2>2. 처리 목적</h2>
          <ul>
            <li>회원 가입·로그인과 계정 관리</li>
            <li>메모·플래너·그래프 등 서비스 제공과 기기 간 동기화</li>
            <li>이용자가 요청한 AI 기능(요약·분석·대화·연결 추천) 제공</li>
            <li>이용자가 선택한 Google Drive 백업, Google Calendar 동기화, 알림 제공</li>
            <li>서비스 개선을 위한 이용 통계(내용 없이 날짜·횟수만), 오류 확인과 해결</li>
          </ul>
        </section>

        <section>
          <h2>3. 보유 및 이용 기간</h2>
          <ul>
            <li>개인정보는 회원 탈퇴(설정 → 계정 삭제) 시 지체 없이 삭제합니다. 데이터베이스의 모든 데이터와 첨부 파일을 지우고, 연결한 Google 권한을 철회합니다.</li>
            <li>휴지통으로 옮긴 메모는 30일이 지나면 자동으로 삭제됩니다.</li>
            <li>이용자의 Google Drive에 만든 백업 파일은 이용자 소유이므로 탈퇴해도 자동으로 지워지지 않습니다. 필요하면 Drive에서 직접 삭제해 주세요.</li>
            <li>처리를 맡긴 업체의 서버 기록(접속·오류 기록 등)은 각 업체의 보관 정책에 따릅니다.</li>
            <li>관련 법령에서 보관을 요구하는 경우에는 그 기간 동안 보관합니다.</li>
          </ul>
        </section>

        <section>
          <h2>4. 제3자 제공</h2>
          <p>서비스는 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다. 다만 법령에 따라 수사기관 등이 적법한 절차로 요청하는 경우에는 예외로 합니다.</p>
        </section>

        <section>
          <h2>5. 처리 위탁 및 국외 이전</h2>
          <p>
            서비스 운영을 위해 아래 업체에 개인정보 처리를 맡기며, 이 과정에서 개인정보가 국외로 이전됩니다.
            이전은 서비스 이용 시점에 암호화된 네트워크(HTTPS)로 이루어지며, 보유 기간은 회원 탈퇴 시까지 또는 각 업체의 정책에 따릅니다.
          </p>
          {/* 좁은 화면: 업체별 카드 */}
          <ul className="mt-4 space-y-3 sm:hidden list-none! pl-0!">
            {VENDORS.map((v) => (
              <li key={v.name} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{v.name}</p>
                <dl className="mt-1.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                  <dt className="text-gray-500">국가</dt><dd>{v.country}</dd>
                  <dt className="text-gray-500">이전 항목</dt><dd>{v.items}</dd>
                  <dt className="text-gray-500">목적</dt><dd>{v.purpose}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden sm:block overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">업체</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">국가</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">이전 항목</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">목적</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 align-top">
                {VENDORS.map((v) => (
                  <tr key={v.name}>
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">{v.name}</td>
                    <td className="px-3 py-2.5">{v.country}</td>
                    <td className="px-3 py-2.5">{v.items}</td>
                    <td className="px-3 py-2.5">{v.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            AI 기능에 보낸 내용은 Anthropic·OpenAI의 API 정책에 따라 처리됩니다. 두 업체 모두 API로 받은 데이터를 기본적으로 모델 학습에 쓰지 않으며,
            남용 방지 등을 위해 정해진 기간 보관한 뒤 삭제한다고 밝히고 있습니다. 자세한 내용은{' '}
            <a href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noopener noreferrer">Anthropic 상업 약관</a>,{' '}
            <a href="https://privacy.anthropic.com" target="_blank" rel="noopener noreferrer">Anthropic 개인정보 센터</a>,{' '}
            <a href="https://openai.com/enterprise-privacy/" target="_blank" rel="noopener noreferrer">OpenAI API 데이터 정책</a>을 확인해 주세요.
          </p>
          <p className="mt-3">국외 이전을 원하지 않으면 회원 탈퇴로 처리를 중단할 수 있으며, 이 경우 서비스를 이용할 수 없습니다. AI 기능은 사용하지 않으면 해당 업체로 내용이 전송되지 않습니다.</p>
        </section>

        <section>
          <h2>6. Google 사용자 데이터</h2>
          <ul>
            <li><strong>Google 로그인</strong>: 이름·이메일 주소·프로필 사진을 계정 생성과 로그인에만 사용합니다.</li>
            <li><strong>Google Drive</strong>(선택, <code>drive.file</code> 권한): 이용자가 연결한 경우에만 Weave 백업 파일을 만들고 불러옵니다. Weave가 만들지 않은 파일에는 접근하지 않습니다.</li>
            <li><strong>Google Calendar</strong>(선택): 이용자가 연결하고 동기화를 실행한 경우에만 플랜을 기본 캘린더에 일정으로 추가합니다. 기존 일정을 읽지 않습니다.</li>
          </ul>
          <p className="mt-3">
            {SITE_NAME}가 Google API에서 받은 정보를 사용하고 다른 앱으로 전송하는 방식은 제한적 사용(Limited Use) 요구사항을 포함한{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API 서비스 사용자 데이터 정책</a>을 따릅니다.
            Google 사용자 데이터를 광고에 쓰거나 판매하지 않으며, AI 모델 학습에 쓰지 않습니다. 연결은 설정에서 언제든 해제할 수 있고,{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google 계정의 서드파티 연결</a>에서도 철회할 수 있습니다.
          </p>
        </section>

        <section>
          <h2>7. 파기 절차와 방법</h2>
          <p>보유 기간이 끝나거나 처리 목적을 달성한 개인정보는 지체 없이 파기합니다. 전자 파일은 복구할 수 없는 방법으로 삭제하며, 종이 문서로는 개인정보를 보관하지 않습니다.</p>
        </section>

        <section>
          <h2>8. 이용자의 권리와 행사 방법</h2>
          <ul>
            <li>열람·정정: 서비스 안에서 내 메모·플랜·계정 정보를 언제든 보고 고칠 수 있습니다.</li>
            <li>내보내기: 설정에서 메모를 Markdown·JSON·PDF로 내보낼 수 있습니다.</li>
            <li>삭제·처리 정지: 개별 콘텐츠는 직접 삭제할 수 있고, 설정 → 계정 삭제로 모든 개인정보를 지울 수 있습니다. 선택 기능(Drive·Calendar·알림)은 설정에서 끌 수 있습니다.</li>
            <li>그 밖의 요청은 아래 개인정보 보호책임자에게 이메일로 보내 주시면 지체 없이 처리하겠습니다.</li>
          </ul>
        </section>

        <section>
          <h2>9. 안전성 확보 조치</h2>
          <ul>
            <li>모든 통신은 HTTPS로 암호화합니다.</li>
            <li>Google 연결 토큰은 AES-256-GCM으로 암호화하여 저장합니다.</li>
            <li>데이터베이스 행 단위 접근 제어(RLS)로 본인 데이터만 읽고 쓸 수 있게 합니다.</li>
            <li>데이터베이스 관리용 키는 서버에만 보관하고 브라우저로 보내지 않습니다.</li>
          </ul>
        </section>

        <section>
          <h2>10. 쿠키와 브라우저 저장소</h2>
          <p>
            로그인 상태를 유지하기 위한 쿠키와, 빠른 화면 표시·오프라인 사용을 위한 브라우저 저장소(로컬 저장소, IndexedDB, 서비스 워커 캐시)를 사용합니다.
            광고·추적 쿠키나 외부 분석 도구는 사용하지 않습니다. 브라우저 설정에서 쿠키를 거부할 수 있지만, 이 경우 로그인이 필요한 기능을 쓸 수 없습니다.
          </p>
        </section>

        <section>
          <h2>11. 만 14세 미만 아동</h2>
          <p>서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 아동의 개인정보를 알고서 수집하지 않습니다.</p>
        </section>

        <section>
          <h2>12. 개인정보 보호책임자</h2>
          <ul>
            <li>책임자: {PRIVACY_OFFICER}</li>
            <li>이메일: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
          </ul>
          <p className="mt-3">
            개인정보 침해에 대한 상담이 필요하면 개인정보침해신고센터(국번 없이 118, privacy.kisa.or.kr), 개인정보분쟁조정위원회(1833-6972, www.kopico.go.kr)에 문의할 수 있습니다.
          </p>
        </section>

        <section>
          <h2>13. 처리방침의 변경</h2>
          <p>
            이 처리방침은 {POLICY_EFFECTIVE_DATE}부터 적용됩니다. 내용이 바뀌면 시행 전에 서비스 안에서 알리고, 이 페이지의 시행일을 갱신합니다.
            이용약관은 <Link href="/terms">여기</Link>에서 볼 수 있습니다.
          </p>
        </section>
      </PolicyArticle>
    </PublicShell>
  )
}
