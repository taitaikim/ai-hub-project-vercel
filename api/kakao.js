// [A.I.K.H. 3.0] Vercel 서버리스 함수 (LWW 적용)
// 경로: /api/kakao.js

import { db, auth, openai, notion, NOTION_DATABASE_ID, getAiSummary, saveToNotion } from './lib/ai-hub.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // Vercel은 표준 POST 요청을 자동으로 파싱합니다.
    const requestBody = req.body; 
    console.log('💬 [카카오] Vercel 워크플로우 시작!');
    let responseMessage = ""; 
    
    try {
        const userMessage = requestBody.userRequest.utterance;
        const kakaoChatId = requestBody.userRequest.user.id; 

        // [명령어 분석 1] '/연결' 명령인가?
        if (userMessage.startsWith('/연결 ')) {
            // ... (기존 '/연결' 로직 생략) ...
            const code = userMessage.split(' ')[1]; 
            const codeRef = db.collection('linkCodes').doc(code);
            const codeDoc = await codeRef.get();
            if (!codeDoc.exists) { throw new Error('코드가 존재하지 않습니다.'); }
            if (codeDoc.data().expiresAt.toDate() < new Date()) {
                await codeRef.delete(); 
                throw new Error('코드가 만료되었습니다.');
            }
            const firebaseUid = codeDoc.data().uid;
            const fbRef = db.collection('userMappingsByFirebaseUid').doc(firebaseUid);
            await fbRef.set({ kakaoChatId: kakaoChatId });
            const kakaoRef = db.collection('userMappingsByKakaoId').doc(kakaoChatId);
            await kakaoRef.set({ firebaseUid: firebaseUid });
            await codeRef.delete();
            console.log(`✅ [계정 연결] '${kakaoChatId}' <-> '${firebaseUid}' 영구 연결 성공!`);
            responseMessage = "✅ 계정 연결 성공! 이제부터 보내는 메모는 사장님의 Notion에 자동 저장됩니다.";
        } 
        // [명령어 분석 2] '일반 메모'인가?
        else {
            // ... (기존 '일반 메모' 로직) ...
            const mappingRef = db.collection('userMappingsByKakaoId').doc(kakaoChatId);
            const mappingDoc = await mappingRef.get();
            if (!mappingDoc.exists) { throw new Error('auth/user-not-found'); }
            const firebaseUid = mappingDoc.data().firebaseUid;
            const aiSummary = await getAiSummary(userMessage);
            const savedDate = new Date();
            
            // [STEP 1] Firebase 저장 (메모 생성)
            const docRef = await db.collection('memos').add({
                uid: firebaseUid, 
                text: userMessage,
                summary: aiSummary,
                createdAt: savedDate,
                notionPageId: null,
                lastEditedAt: new Date(), // ⬅️ [LWW 핵심] 현재 시간 기록 추가
            });
            const firebaseId = docRef.id; 
            console.log('🚀 [Firebase] 카카오 메모 저장 성공!');
            
            // [STEP 2 & 3] Notion 동시 저장 및 Notion ID 기록
            const notionPage = await saveToNotion(firebaseUid, userMessage, aiSummary, savedDate, firebaseId);
            await docRef.update({ notionPageId: notionPage.id });
            
            responseMessage = `✅ [AI 허브] 저장 완료!\n(Notion DB를 확인해 보세요!)`;
        }
    } catch (error) {
        console.error('🔥 [카카오] Vercel 처리 중 심각한 오류!', error);
        if (error.message === 'auth/user-not-found') {
            responseMessage = "❌ 계정 연결이 필요합니다!\n\n웹사이트에 로그인 후, [카카오톡 계정 연결] 버튼을 눌러 '1회용 코드'를 발급받아 '/연결 [코드]'를 보내주세요!";
        } else if (error.message.includes('코드')) {
            responseMessage = `❌ ${error.message} 다시 시도해주세요.`;
        } else {
            responseMessage = "❌ 죄송합니다, AI 허브 저장에 실패했습니다...";
        }
    }
    const kakaoResponse = {
        version: "2.0",
        template: { outputs: [ { simpleText: { text: responseMessage } } ] }
    };
    return res.status(200).json(kakaoResponse);
}