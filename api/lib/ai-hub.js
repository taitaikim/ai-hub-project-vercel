// [A.I.K.H. 2.0] Vercel '중앙 통제실' (최종본)
// 경로: /_lib/ai-hub.js
// (모든 엔진 + 모든 공용 함수 포함)

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { OpenAI } from 'openai';
import { Client } from '@notionhq/client';

// --- 1. Firebase 엔진 ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

// --- 2. '모든' 엔진을 '수출(export)'합니다 ---
export const db = getFirestore(app);
export const auth = getAuth(app);

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export const notion = new Client({ 
    auth: process.env.NOTION_API_KEY,
    notionVersion: '2025-09-03'
});
export const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;


// --- 3. [공용 함수 1] '보안 검사관' ---
export async function verifyToken(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).send('인증되지 않은 사용자입니다.');
        return null; 
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        return decodedToken; // '성공' (사용자 정보 반환)
    } catch (error) {
        res.status(403).send('유효하지 않은 인증입니다.');
        return null; 
    }
}

// --- 4. [공용 함수 2] 'AI 요약' ---
export async function getAiSummary(text) {
    console.log('🤖 [AI] (공용함수) 요약 요청...');
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "You are a helpful assistant that summarizes text in one concise Korean sentence." },
            { role: "user", content: text }
        ],
    });
    return completion.choices[0].message.content;
}

// --- 5. [공용 함수 3] 'Notion 저장' (Create) ---
export async function saveToNotion(uid, text, summary, date, firebaseId) {
    const response = await notion.pages.create({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
            "Original Text": { title: [{ text: { content: text.substring(0, 100) } }] },
            "AI Summary": { rich_text: [{ text: { content: summary } }] },
            "Firebase UID": { rich_text: [{ text: { content: uid } }] },
            "Saved At": { date: { start: date.toISOString() } },
            "Firebase Doc ID": { rich_text: [{ text: { content: firebaseId } }] }
        }
    });
    return response;
}

// --- 6. [공용 함수 4] 'Notion 수정' (Update) ---
// (S6 양방향 동기화의 '핵심' 로직)
export async function updateNotionPage(notionPageId, newText, newSummary) {
    console.log(`🔄 [Notion Sync] Vercel -> Notion '${notionPageId}' 수정 시도...`);
    await notion.pages.update({
        page_id: notionPageId,
        properties: {
            "Original Text": { title: [{ text: { content: newText.substring(0, 100) } }] },
            "AI Summary": { rich_text: [{ text: { content: newSummary } }] }
        }
    });
}

// --- 7. [공용 함수 5] 'Notion 삭제' (Delete) ---
// (S6 양방향 동기화의 '핵심' 로직)
export async function deleteNotionPage(notionPageId) {
    console.log(`🔄 [Notion Sync] Vercel -> Notion '${notionPageId}' 삭제(보관) 시도...`);
    await notion.pages.update({
        page_id: notionPageId,
        archived: true // (Notion은 '삭제' 대신 '보관(archived)'을 사용합니다)
    });
}