
const axios = require('axios');
async function run() {
    try {
        const res = await axios.get('https://www3.animeflv.net/anime/seishun-buta-yarou-wa-santa-claus-no-yume-wo-minai', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        console.log(res.data);
    } catch (e) { console.error(e); }
}
run();
