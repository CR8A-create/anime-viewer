
const axios = require('axios');

async function test() {
    try {
        const response = await axios.get('http://localhost:3000/api/anime/Seishun%20Buta%20Yarou%20wa%20Santa%20Claus%20no%20Yume%20wo%20Minai');
        console.log(JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}
test();
