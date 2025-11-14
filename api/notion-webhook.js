// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Zero-Error / '공식 보안' 탑재)
// 경로: /api/notion-webhook.js

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js';
import { createHmac, timingSafeEqual } from 'crypto'; // ⬅️ [공식 보안 모듈 추가]

// --- 1. 엔진 초기화 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);

// --- 2. 보안 변수 설정 (공식 매뉴얼 기반) ---
const VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;

// --- 3. [핵심 공용 함수] Notion 서명 검증 (Official Signature Validation) ---
function validateNotionSignature(body, headers) {
    const signature = headers['x-notion-signature'];
    if (!signature) {
        // 서명이 없으면 거부 (Challenge 요청은 이 코드를 스킵합니다)
        return false;
    }

    const calculatedSignature = `sha256=${createHmac("sha256", VERIFICATION_TOKEN)
        .update(JSON.stringify(body))
        .digest("hex")}`;

    // TimingSafeEqual을 사용하여 토큰 노출 없이 안전하게 비교
    return timingSafeEqual(
        Buffer.from(calculatedSignature),
        Buffer.from(signature)
    );
}

// --- 4. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // [중요!] req.body가 JSON이 아닐 수 있으므로 '수동' 파싱을 유지하고, 
    // 서명 검증을 위해 'req.body'의 '순수 텍스트'를 확보합니다.
    const rawBody = JSON.stringify(req.body);
    const event = req.body; 

    // --- 👇 [1단계] Notion '인증 토큰(verification_token)' 회수 로직 👇 ---
    // (웹훅을 처음 생성했을 때 Notion이 보내는 '초기 1회' 신호)
    if (event.verification_token) {
        console.log("✅ [Notion Webhook] '최초 검증 토큰' 수신! 이 토큰을 Vercel Env Var에 저장하세요.");
        console.log(`⭐️ 복사할 토큰: ${event.verification_token} ⭐️`);
        
        // Notion 매뉴얼에 따라 200 OK만 반환하면 인증 완료 (토큰은 수동 저장)
        return res.status(200).json({ message: 'Verification token received. Please save it to Vercel Env Vars.' });
    }
    // --- 👆 [1단계] 인증 로직 끝 👆 ---


    // --- 👇 [2단계] '서명 검증' 및 '데이터 동기화' 로직 👇 ---

    // [보안 1] 서명 검증 (데이터 무결성 확인)
    if (!validateNotionSignature(rawBody, req.headers)) {
        console.warn("🔥 [Notion Webhook] 서명 불일치 또는 토큰 누락! 데이터 거부.");
        return res.status(401).json({ message: 'Unauthorized Signature' });
    }
    
    // --- (서명 검증 통과) ---
    try {
        // [업그레이드 1] '수정' 이벤트 처리
        if (event.event === 'page.property_value.changed') {
            // ... (기존 로직: AI 재요약 및 Firebase 업데이트) ...
            return res.status(200).json({ message: 'Update sync successful!' });
        }

        // [업그레이드 2] '삭제' 이벤트 처리
        if (event.event === 'page.archived' || event.event === 'page.deleted') {
            // ... (기존 로직: Firebase에서 메모 삭제) ...
            return res.status(200).json({ message: 'Delete sync successful!' });
        }
        
        // 그 외 이벤트 (무시)
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] 동기화 처리 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}