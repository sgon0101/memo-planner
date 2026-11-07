import type { Metadata } from 'next'
import Link from 'next/link'
import PublicShell, { PolicyArticle } from '@/components/public/PublicShell'
import { CONTACT_EMAIL, POLICY_EFFECTIVE_DATE, SITE_NAME } from '@/lib/site'

/** 이용약관 (2026-11-07) — 개인이 운영하는 베타 서비스 기준 */

export const metadata: Metadata = {
  title: `이용약관 | ${SITE_NAME}`,
  description: `${SITE_NAME} 서비스 이용약관입니다.`,
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <PublicShell>
      <PolicyArticle title="이용약관" effective={POLICY_EFFECTIVE_DATE}>
        <section>
          <h2>제1조 (목적)</h2>
          <p>이 약관은 개인이 운영하는 {SITE_NAME}(이하 ‘서비스’)를 이용하는 조건과 절차, 운영자와 이용자의 권리·의무를 정합니다.</p>
        </section>

        <section>
          <h2>제2조 (서비스 내용)</h2>
          <p>서비스는 메모 작성과 위키·태그 연결, 그래프 보기, 플래너, 첨부 파일 요약 등 AI 기능, 선택적인 Google Drive 백업과 Google Calendar 동기화를 제공합니다.</p>
        </section>

        <section>
          <h2>제3조 (베타 서비스)</h2>
          <p>서비스는 현재 베타 단계입니다. 기능이 예고 없이 바뀌거나 일부가 중단될 수 있으며, 중요한 변경은 가능한 한 미리 알립니다. 소중한 데이터는 설정의 내보내기나 Google Drive 백업으로 따로 보관해 두시길 권합니다.</p>
        </section>

        <section>
          <h2>제4조 (계정)</h2>
          <ol>
            <li>이용자는 이메일 또는 Google 계정으로 가입할 수 있습니다. 만 14세 미만은 가입할 수 없습니다.</li>
            <li>계정 정보와 비밀번호의 관리 책임은 이용자에게 있습니다. 계정이 도용된 사실을 알게 되면 바로 운영자에게 알려 주세요.</li>
          </ol>
        </section>

        <section>
          <h2>제5조 (콘텐츠의 권리)</h2>
          <ol>
            <li>이용자가 작성하거나 올린 메모·플랜·파일 등 콘텐츠의 권리는 이용자에게 있습니다.</li>
            <li>운영자는 서비스를 제공하는 데 필요한 범위(저장, 동기화, 이용자가 요청한 AI 처리, 백업)에서만 콘텐츠를 처리하며, 그 밖의 목적으로 쓰거나 공개하지 않습니다.</li>
            <li>이용자는 타인의 저작권 등 권리를 침해하는 콘텐츠를 올리지 않아야 합니다.</li>
          </ol>
        </section>

        <section>
          <h2>제6조 (금지 행위)</h2>
          <ul>
            <li>다른 사람의 계정이나 정보를 도용하는 행위</li>
            <li>서비스나 서버에 비정상적인 부하를 주거나, 보안을 우회·공격하는 행위</li>
            <li>자동화된 방법으로 AI 기능 등을 과도하게 호출하는 행위</li>
            <li>법령이나 공공질서에 어긋나는 콘텐츠를 저장·전송하는 행위</li>
          </ul>
          <p className="mt-3">이를 어기면 운영자는 사전 안내 후 이용을 제한할 수 있으며, 긴급한 경우에는 먼저 제한한 뒤 알릴 수 있습니다.</p>
        </section>

        <section>
          <h2>제7조 (AI 기능)</h2>
          <p>요약·분석·대화·추천 등 AI 기능의 결과는 자동으로 만들어지며 부정확하거나 빠진 내용이 있을 수 있습니다. 중요한 결정에는 원문을 확인해 주세요. AI 기능에는 하루 사용 한도가 있을 수 있습니다.</p>
        </section>

        <section>
          <h2>제8조 (책임의 제한)</h2>
          <ol>
            <li>운영자는 천재지변, 외부 업체(호스팅·데이터베이스·AI 제공업체 등)의 장애, 이용자의 귀책 사유로 인한 손해에 대해서는 책임을 지지 않습니다.</li>
            <li>운영자는 무료로 제공하는 서비스와 관련하여 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.</li>
          </ol>
        </section>

        <section>
          <h2>제9조 (탈퇴와 이용 종료)</h2>
          <p>이용자는 언제든 설정 → 계정 삭제로 탈퇴할 수 있으며, 이때 개인정보와 콘텐츠는 <Link href="/privacy">개인정보 처리방침</Link>에 따라 삭제됩니다. 운영자가 서비스를 종료하는 경우에는 30일 이상 앞서 알리고 데이터를 내보낼 기회를 드립니다.</p>
        </section>

        <section>
          <h2>제10조 (약관의 변경)</h2>
          <p>약관을 바꿀 때는 시행 7일 전(이용자에게 불리한 변경은 30일 전)부터 서비스 안에서 알립니다. 바뀐 약관에 동의하지 않으면 탈퇴할 수 있습니다.</p>
        </section>

        <section>
          <h2>제11조 (준거법과 분쟁 해결)</h2>
          <p>이 약관은 대한민국 법을 따르며, 분쟁이 생기면 먼저 성실히 협의하고, 해결되지 않으면 민사소송법에 따른 관할 법원에서 해결합니다.</p>
        </section>

        <section>
          <h2>제12조 (문의)</h2>
          <p>서비스 이용에 관한 문의는 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>로 보내 주세요.</p>
        </section>

        <p className="text-sm text-gray-500 dark:text-gray-400">부칙: 이 약관은 {POLICY_EFFECTIVE_DATE}부터 시행합니다.</p>
      </PolicyArticle>
    </PublicShell>
  )
}
