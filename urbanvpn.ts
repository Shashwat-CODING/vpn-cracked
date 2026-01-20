
// urban_vpn_proxy.ts

const ACCOUNT_API = "https://api-pro.urban-vpn.com/rest/v1";
const STATS_API = "https://stats.urban-vpn.com/api/rest/v2";
const CLIENT_APP = "URBAN_VPN_BROWSER_EXTENSION";
const BROWSER = "CHROME";

async function main() {
    console.log("Fetching Urban VPN Proxy...");

    // 1. Register Anonymous
    console.log("1. Registering Anonymous User...");
    const regUrl = `${ACCOUNT_API}/registrations/clientApps/${CLIENT_APP}/users/anonymous`;

    const regHeaders = {
        "content-type": "application/json",
        "accept": "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
    };

    const regPayload = {
        clientApp: {
            name: CLIENT_APP,
            browser: BROWSER
        }
    };

    let regResp;
    try {
        regResp = await fetch(regUrl, {
            method: "POST",
            headers: regHeaders,
            body: JSON.stringify(regPayload)
        });
    } catch (err) {
        console.error("Network error during registration:", err);
        Deno.exit(1);
    }

    if (!regResp.ok) {
        const text = await regResp.text();
        console.error(`Registration failed: ${regResp.status} ${regResp.statusText}`);
        console.error(text);
        if (regResp.status === 429) {
            console.error("Rate limit hit.");
        }
        Deno.exit(1);
    }

    const regData = await regResp.json();
    const idToken = regData.id_token || regData.idToken || regData.value;

    if (!idToken) {
        console.error("No ID token found in registration response.");
        console.log(regData);
        Deno.exit(1);
    }

    // 2. Get Security Token
    console.log("2. Getting Security Token...");
    const secUrl = `${ACCOUNT_API}/security/tokens/accs`;
    const secHeaders = {
        ...regHeaders,
        "authorization": `Bearer ${idToken}`
    };
    const secPayload = {
        type: "accs",
        clientApp: {
            name: CLIENT_APP
        }
    };

    const secResp = await fetch(secUrl, {
        method: "POST",
        headers: secHeaders,
        body: JSON.stringify(secPayload)
    });

    if (!secResp.ok) {
        const text = await secResp.text();
        console.error(`Security Token request failed: ${secResp.status}`);
        console.error(text);
        Deno.exit(1);
    }

    const secData = await secResp.json();
    console.log("Security Token Response:", JSON.stringify(secData, null, 2));

    // Based on code analysis:
    // credentials: { username: i.value, password: "1" }
    // where i is the token object.

    let tokenString = "";
    let credUsername = "";
    const credPassword = "1";

    if (secData.token && typeof secData.token === 'object' && secData.token.value) {
        tokenString = secData.token.value;
        credUsername = secData.token.value;
    } else if (typeof secData.token === 'string') {
        tokenString = secData.token;
        credUsername = secData.token;

    } else if (secData.value) {
        tokenString = secData.value;
        credUsername = secData.value;
    }

    if (!tokenString) {
        console.error("No security token found.");
        console.log("Response keys:", Object.keys(secData));
        Deno.exit(1);
    }

    // 3. Get Countries / Proxies
    console.log("3. Fetching Proxy List...");
    const countriesUrl = `${STATS_API}/entrypoints/countries`;
    const proxyHeaders = {
        ...regHeaders,
        "authorization": `Bearer ${tokenString}`,
        "X-Client-App": CLIENT_APP
    };
    delete proxyHeaders["content-type"];

    const countriesResp = await fetch(countriesUrl, {
        headers: proxyHeaders
    });

    if (!countriesResp.ok) {
        const text = await countriesResp.text();
        console.error(`Failed to fetch countries: ${countriesResp.status}`);
        console.error(text);
        Deno.exit(1);
    }

    const countriesData = await countriesResp.json();

    if (!countriesData.countries || !countriesData.countries.elements) {
        console.error("Invalid countries data format.");
        Deno.exit(1);
    }

    const countries = countriesData.countries.elements;
    console.log(`Found ${countries.length} countries.`);

    // Find a US proxy for example
    const targetCountry = countries.find((c: any) => c.code.iso2 === "US") || countries[0];

    if (targetCountry) {
        console.log(`Selected Country: ${targetCountry.title} (${targetCountry.code.iso2})`);
        console.log("Full Country Object:", JSON.stringify(targetCountry, null, 2));

        let proxyHost = null;
        let proxyPort = null;
        let signature = null;

        if (targetCountry.address && targetCountry.address.primary) {
            // These might not have signatures?
            proxyHost = targetCountry.address.primary.host;
            proxyPort = targetCountry.address.primary.port;
        }
        else if (targetCountry.servers && targetCountry.servers.elements && targetCountry.servers.elements.length > 0) {
            const srv = targetCountry.servers.elements[0];
            if (srv.address && srv.address.primary) {
                proxyHost = srv.address.primary.host;
                proxyPort = srv.address.primary.port || srv.address.primary.port_min;
                signature = srv.signature;
            }
        }

        if (signature) {
            console.log("Found proxy signature, fetching Auth Proxy Token...");
            const proxyTokenUrl = `${ACCOUNT_API}/security/tokens/accs-proxy`;
            const proxyTokenPayload = {
                type: "accs-proxy",
                clientApp: { name: CLIENT_APP },
                signature: signature
            };

            // Reuse headers but update auth to use the initial ID Token? 
            // Or maybe it uses the Security Token? 
            // The code snippet showed: n = yield this.tokenClient.getAuthProxyToken(r);
            // tokenClient likely has the bearer token set already.
            // Usually it uses the ID Token or the Access Token.
            // Let's assume it uses the same `tokenString` (Security Token) for Authorization.

            const proxyTokenHeaders = {
                ...regHeaders,
                "authorization": `Bearer ${tokenString}`
            };

            const ptResp = await fetch(proxyTokenUrl, {
                method: "POST",
                headers: proxyTokenHeaders,
                body: JSON.stringify(proxyTokenPayload)
            });

            if (ptResp.ok) {
                const ptData = await ptResp.json();
                if (ptData.value) {
                    credUsername = ptData.value;
                    console.log("Successfully obtained Proxy Auth Token.");
                } else if (ptData.token && ptData.token.value) {
                    credUsername = ptData.token.value;
                    console.log("Successfully obtained Proxy Auth Token (nested).");
                } else {
                    console.error("Proxy Auth Token response format unknown:", ptData);
                }
            } else {
                console.error(`Failed to get Proxy Auth Token: ${ptResp.status}`);
                console.error(await ptResp.text());
            }
        } else {
            console.log("No signature found for proxy, using Security Token as username.");
        }

        if (proxyHost) {
            console.log(`\nProxy: http://${proxyHost}:${proxyPort}`);
            console.log(`Username: ${credUsername}`);
            console.log(`Password: ${credPassword}`);

            // Format for easy copying: http://user:pass@host:port
            const proxyString = `http://${credUsername}:${credPassword}@${proxyHost}:${proxyPort}`;
            console.log(`\nExport Command:`);
            console.log(`export http_proxy='${proxyString}'`);
            console.log(`export https_proxy='${proxyString}'`);
        } else {
            console.error("No proxy server details found for this country.");
        }

    } else {
        console.error("No countries available.");
    }
}

if (import.meta.main) {
    main();
}
