// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 6 - 'JSON 파서' 최종 통합본)
// 경로: /api/memos/[id].js

// --- 1. '통제실'에서 '부품' 가져오기 ---
import {
    db,
    auth,
    verifyToken,
    getAiSummary,
    updateNotionPage,
    deleteNotionPage
} from '../../lib/ai-hub.js'; // ⬅️ [최종 수정!] (경로: api/memos/[id].js -> api/ -> lib/)

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안] '보안 검사관' 호출
    const user = await verifyToken(req, res);
    if (!user) {
        return; // 인증 실패
    }
    
    // [핵심] Vercel은 '파일 이름'([id].js)을 'req.query.id'로 변환
    const memoId = req.query.id;
    const uid = user.uid;

    // --- 3. '어떤' 요청인지 '구분'하여 처리 ---

    // [수정] 'PUT' 요청 처리 (웹 앱의 '수정' 버튼)
    if (req.method === 'PUT') {
        
        // --- 👇 [S6-FIX] 'JSON 번역기' 로직 (필수!) 👇 ---
        let requestBody;
        try {
            // Vercel은 'req.body'가 '텍스트'일 수 있으므로 '수동' 파싱
            requestBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch (e) {
            console.error("🔥 [Update] JSON 파싱 실패!", e);
            return res.status(400).json({ message: 'Invalid JSON' });
        }
        // --- 👆 [S6-FIX] 'JSON 번역기' 로직 끝 👆 ---

        try {
            // [수정!] 'req.body'가 아닌 'requestBody' 사용
            const newText = requestBody.text;
            
            // [DB 1] Firebase에서 '원본' 문서 찾기 (권한 확인)
            const docRef = db.collection('memos').doc(memoId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(404).send('문서를 찾을 수 없습니다.'); }
            if (doc.data().uid !== uid) { return res.status(403).send('수정 권한이 없습니다.'); }

            // [AI] '새 텍스트'로 AI 재요약 (공용 함수)
            let newSummary = '';
            try { newSummary = await getAiSummary(newText); } 
            catch (aiError) { newSummary = "AI 재요약에 실패했습니다."; }
            
            // [DB 2] Firebase '업데이트'
            await docRef.update({ text: newText, summary: newSummary });

            // [S6-Sync] 'Notion DB'도 '동시' 업데이트 (공용 함수)
            const notionPageId = doc.data().notionPageId;
            if (notionPageId) {
                await updateNotionPage(notionPageId, newText, newSummary);
            }

            return res.status(200).json({ message: "메모와 AI 요약이 성공적으로 수정되었습니다!" });

        } catch (error) {
            console.error('🔥 [Vercel] Firebase/Notion 수정 실패!', error);
            return res.status(500).json({ message: "서버에서 수정 중 오류 발생" });
        }
    }

    // [삭제] 'DELETE' 요청 처리 (웹 앱의 '삭제' 버튼)
    if (req.method === 'DELETE') {
        // ('DELETE' 요청은 'body'가 없으므로 '번역기' 불필요)
        try {
            // [DB 1] Firebase에서 '원본' 문서 찾기 (권한 확인)
            const docRef = db.collection('memos').doc(memoId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(404).send('문서를 찾을 수 없습니다.'); }
            if (doc.data().uid !== uid) { return res.status(403).send('삭제 권한이 없습니다.'); }
            
            // [DB 2] Firebase '삭제'
            await docRef.delete();
            
            // [S6-Sync] 'Notion DB'도 '동시' 삭제(보관) (공용 함수)
            const notionPageId = doc.data().notionPageId;
            if (notionPageId) {
                await deleteNotionPage(notionPageId);
            }
            
            return res.status(200).json({ message: "메모가 성공적으로 삭제되었습니다!" });

        } catch (error) {
            console.error('🔥 [Vercel] Firebase/Notion 삭제 실패!', error);
            return res.status(500).json({ message: "서버에서 삭제 중 오류 발생" });
        }
    }

    // (PUT, DELETE가 아니면 '허용되지 않음' 응답)
    return res.status(405).json({ message: 'Method Not Allowed' });
}