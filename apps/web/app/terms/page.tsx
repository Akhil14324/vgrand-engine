import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — CatGPT",
  description: "The terms that govern your use of CatGPT.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These Terms of Service (“Terms”) govern your access to and use of CatGPT (the “Service”). By creating an account or using the Service you agree to these Terms. If you do not agree, do not use the Service."
    >
      <Section title="1. The Service">
        <p>
          CatGPT is an AI studio for chat, themed and on-brand image generation, document
          question-answering, campaign planning, voice, shared workspaces with team chat, and
          publishing generated images to social platforms you connect. Features may change, and we
          may add, modify or discontinue parts of the Service at any time.
        </p>
      </Section>

      <Section title="2. Eligibility and accounts">
        <p>
          You must be at least 13 years old (or the age of digital consent in your country) and
          able to form a binding contract. You are responsible for your account credentials and for
          all activity under your account. Provide accurate information and tell us promptly about
          any unauthorised use.
        </p>
      </Section>

      <Section title="3. Your content and AI output">
        <p>
          You retain ownership of the prompts, files and other content you submit (“Your
          Content”). You grant us a limited licence to host, process, transmit and display Your
          Content, and to send it to our AI and infrastructure providers, solely to operate and
          improve the Service for you.
        </p>
        <p>
          As between you and us, and to the extent permitted by law, you may use the images and text
          the Service generates for you (“Output”), subject to these Terms and the terms of the
          underlying model providers. Output may be inaccurate, incomplete or similar to output
          generated for others. You are responsible for reviewing Output before relying on or
          publishing it.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to use the Service to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>break the law or infringe anyone’s intellectual property, privacy or other rights;</li>
          <li>
            create or share content that is sexually explicit involving minors, hateful,
            harassing, defamatory, deceptive, or that promotes violence or self-harm;
          </li>
          <li>impersonate people or organisations or create misleading synthetic media of real people without consent;</li>
          <li>send spam, run coordinated inauthentic behaviour, or otherwise abuse third-party platforms;</li>
          <li>upload malware, probe or disrupt the Service, bypass usage limits, or scrape it at scale;</li>
          <li>violate the acceptable-use policies of our model providers (for example OpenAI) or of any platform you publish to.</li>
        </ul>
        <p>We may remove content or suspend accounts that we reasonably believe violate these Terms.</p>
      </Section>

      <Section title="5. Connected social accounts and publishing">
        <p>
          You may connect Facebook Pages, Instagram professional accounts, X accounts and YouTube
          channels. You confirm that you are authorised to post to each account you connect. We
          publish only what you have reviewed and approved, only to the accounts you select, and
          only when you press Post.
        </p>
        <p>
          You are solely responsible for the content you publish and for complying with each
          platform’s terms, community guidelines, advertising and disclosure rules (including
          labelling AI-generated content where required). Platforms may reject, limit or remove
          posts, rate-limit requests, or change their APIs; we do not guarantee that any post will
          be published or remain available. YouTube uploads may be private while our Google
          application is unverified. Workspace owners may connect shared accounts that workspace
          members can post through; members should post only content the workspace has
          authorised.
        </p>
        <p>
          You can disconnect an account at any time in the app, and may revoke our access from the
          platform. See our{" "}
          <Link href="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          for how tokens are handled.
        </p>
      </Section>

      <Section title="6. Workspaces">
        <p>
          Workspace owners control membership. Content placed in a workspace, and accounts shared
          with it, are accessible to its members. Owners are responsible for who they invite.
        </p>
      </Section>

      <Section title="7. Usage limits and changes">
        <p>
          Image generation is subject to daily limits and fair-use controls. We may change limits,
          pricing or features on reasonable notice where practicable.
        </p>
      </Section>

      <Section title="8. Third-party services">
        <p>
          The Service relies on third parties (such as Supabase, OpenAI, Meta, X, Google, Railway
          and Vercel). Their services are governed by their own terms, and we are not responsible
          for their availability or conduct.
        </p>
      </Section>

      <Section title="9. Intellectual property">
        <p>
          The Service, including its software, design and branding, is owned by us and our
          licensors and is protected by law. Except for the rights expressly granted here, no
          rights are transferred to you. If you send feedback, you allow us to use it without
          restriction or compensation.
        </p>
      </Section>

      <Section title="10. Copyright complaints">
        <p>
          If you believe content on the Service infringes your copyright, contact us at <ContactLine /> with
          details of the work, the location of the material and your contact information, and we
          will review it promptly.
        </p>
      </Section>

      <Section title="11. Suspension and termination">
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate access if you breach these Terms, create risk or legal exposure, or if we
          discontinue the Service. Provisions that by nature should survive termination will
          survive.
        </p>
      </Section>

      <Section title="12. Disclaimers">
        <p>
          THE SERVICE AND ALL OUTPUT ARE PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF
          ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, ACCURACY AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, ERROR-FREE OR SECURE, OR THAT ANY POST WILL BE PUBLISHED.
        </p>
      </Section>

      <Section title="13. Limitation of liability">
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA OR
          GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT
          EXCEED THE GREATER OF THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR USD 100.
          Some jurisdictions do not allow certain limitations, so parts of this section may not
          apply to you.
        </p>
      </Section>

      <Section title="14. Indemnity">
        <p>
          You agree to indemnify and hold us harmless from claims, damages and expenses (including
          reasonable legal fees) arising from Your Content, content you publish, your misuse of
          connected accounts, or your breach of these Terms.
        </p>
      </Section>

      <Section title="15. Changes to these Terms">
        <p>
          We may update these Terms from time to time. We will post the new version here with a
          revised “Last updated” date. Continued use of the Service after changes take effect means
          you accept them.
        </p>
      </Section>

      <Section title="16. General">
        <p>
          These Terms are the entire agreement between you and us regarding the Service. If a
          provision is unenforceable, the rest remains in effect. Our failure to enforce a
          provision is not a waiver. You may not assign these Terms without our consent. The laws
          of the jurisdiction in which we are established govern these Terms, and the courts there
          have exclusive jurisdiction, except where local consumer law provides otherwise.
        </p>
      </Section>

      <Section title="17. Contact">
        <p>
          Questions about these Terms? Contact us at <ContactLine />.
        </p>
      </Section>
    </LegalPage>
  );
}
