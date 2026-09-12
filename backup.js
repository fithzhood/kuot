/* Modulo di travaso dati — generico, per le app dell'hub.
 *
 * Perche' esiste: le vecchie app impacchettate con WebIntoApp non sanno produrre
 * file in uscita (un <a download> viene ignorato in silenzio) e vietano il
 * traffico non cifrato, quindi non si puo' nemmeno parlare con un server locale.
 * L'unica uscita che resta e' il testo sullo schermo, da copiare negli appunti.
 *
 * Siccome gli appunti di Android hanno un tetto, il contenuto viene diviso in
 * pezzi. Ogni pezzo porta in testa una riga con numero, totale e impronta
 * dell'intero, cosi' il rimontaggio si puo' verificare invece di sperarci.
 *
 * Si aggiunge a una pagina con: <script src="backup.js?v=1"></script>
 */
(function () {
    'use strict';

    var PEZZO = 500000;            // caratteri per pezzo
    var MARCA = 'TRAVASO';
    var stato = { pezzi: [], indice: 0, impronta: '', nome: '' };

    function nomeApp() {
        var p = location.pathname.replace(/^\/+|\/+$/g, '') || 'radice';
        return p.replace(/\.html?$/i, '') || 'radice';
    }

    function chiaviLocali() {
        var chiavi = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            chiavi[k] = localStorage.getItem(k);
        }
        return chiavi;
    }

    // Alcune app (Kuot) salvano su IndexedDB e usano la memoria locale solo
    // come ripiego: leggendo solo quella si esporterebbe il vuoto senza
    // accorgersene. Qui si svuotano tutti i database, archivio per archivio,
    // annotando anche com'e' fatta la chiave, che serve per ricrearli.
    function leggiDatabase() {
        if (!window.indexedDB || !indexedDB.databases) return Promise.resolve({});
        return indexedDB.databases().then(function (elenco) {
            return Promise.all((elenco || []).map(function (info) {
                return new Promise(function (risolvi) {
                    var req = indexedDB.open(info.name);
                    req.onerror = function () { risolvi(null); };
                    req.onsuccess = function () {
                        var db = req.result;
                        var nomi = Array.prototype.slice.call(db.objectStoreNames);
                        if (!nomi.length) { db.close(); risolvi([info.name, { versione: db.version, archivi: {} }]); return; }
                        var tx = db.transaction(nomi, 'readonly');
                        var archivi = {};
                        var restanti = nomi.length;
                        nomi.forEach(function (nome) {
                            var st = tx.objectStore(nome);
                            var meta = { keyPath: st.keyPath, autoIncrement: st.autoIncrement };
                            var tutto = st.getAll();
                            tutto.onsuccess = function () {
                                archivi[nome] = { meta: meta, righe: tutto.result };
                                if (--restanti === 0) { db.close(); risolvi([info.name, { versione: db.version, archivi: archivi }]); }
                            };
                            tutto.onerror = function () {
                                archivi[nome] = { meta: meta, righe: [] };
                                if (--restanti === 0) { db.close(); risolvi([info.name, { versione: db.version, archivi: archivi }]); }
                            };
                        });
                    };
                });
            })).then(function (coppie) {
                var out = {};
                coppie.forEach(function (c) { if (c) out[c[0]] = c[1]; });
                return out;
            });
        }).catch(function () { return {}; });
    }

    function raccogli() {
        return leggiDatabase().then(function (db) {
            return {
                travaso: 2,
                app: nomeApp(),
                origin: location.origin,
                exportedAt: new Date().toISOString(),
                chiavi: chiaviLocali(),
                database: db
            };
        });
    }

    function sha256hex(testo) {
        if (!(window.crypto && crypto.subtle)) return Promise.resolve('nohash');
        return crypto.subtle
            .digest('SHA-256', new TextEncoder().encode(testo))
            .then(function (buf) {
                return Array.prototype.map
                    .call(new Uint8Array(buf), function (b) {
                        return ('0' + b.toString(16)).slice(-2);
                    })
                    .join('');
            });
    }

    function dividi(testo) {
        var out = [];
        for (var i = 0; i < testo.length; i += PEZZO) out.push(testo.slice(i, i + PEZZO));
        return out.length ? out : [''];
    }

    // --- interfaccia -----------------------------------------------------

    var pannello, info, area, btnCopia, btnAvanti, btnIndietro;

    function css(el, s) { for (var k in s) el.style[k] = s[k]; }

    // Come si apre il pannello.
    //
    // Prima c'era un pulsante fisso in alto a sinistra, sempre in vista: un
    // comando di servizio piantato in mezzo all'app, che dava fastidio. Ora
    // non c'e' nessun pulsante di serie. Si apre in tre modi:
    //
    //   1. un elemento qualsiasi della pagina con l'attributo `data-travaso`
    //      (il posto giusto: dentro il menu o le impostazioni dell'app);
    //   2. una pressione lunga (1 secondo) sul titolo, che ogni pagina ha:
    //      serve come via di servizio anche dove il menu non c'e';
    //   3. window.travaso.apri(), per chi vuole agganciarlo altrove.
    function collegaAperture() {
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-travaso]'),
            function (el) { el.addEventListener('click', apriPannello); }
        );

        var titolo = document.querySelector('h1') ||
                     document.querySelector('.app-header') ||
                     document.querySelector('header');
        if (!titolo) return;

        var timer = null;
        var parti = function () {
            fermati();
            timer = setTimeout(function () { timer = null; apriPannello(); }, 1000);
        };
        var fermati = function () {
            if (timer) { clearTimeout(timer); timer = null; }
        };
        titolo.addEventListener('touchstart', parti, { passive: true });
        titolo.addEventListener('mousedown', parti);
        ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave']
            .forEach(function (ev) { titolo.addEventListener(ev, fermati); });
        // Su Android la pressione lunga aprirebbe la lente del testo: qui no.
        titolo.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    function costruisci() {
        pannello = document.createElement('div');
        css(pannello, {
            position: 'fixed', inset: '0', zIndex: '2147483647', display: 'none',
            background: 'rgba(0,0,0,0.88)', color: '#eee', padding: '12px',
            font: '14px system-ui, sans-serif', overflow: 'auto',
            boxSizing: 'border-box'
        });

        info = document.createElement('p');
        css(info, { margin: '0 0 8px', lineHeight: '1.4', wordBreak: 'break-word' });

        area = document.createElement('textarea');
        area.readOnly = true;
        area.spellcheck = false;
        css(area, {
            width: '100%', height: '150px', boxSizing: 'border-box', padding: '6px',
            font: '11px monospace', color: '#ddd', background: '#15161a',
            border: '1px solid #444', borderRadius: '6px', wordBreak: 'break-all',
            webkitUserSelect: 'text', userSelect: 'text'
        });

        var riga = document.createElement('div');
        css(riga, { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' });

        btnIndietro = bottone('◀ prec', function () { vaiA(stato.indice - 1); });
        btnCopia = bottone('Copia pezzo', copiaCorrente);
        btnAvanti = bottone('succ ▶', function () { vaiA(stato.indice + 1); });
        var btnFile = bottone('Importa da file', function () { input.click(); });
        var btnChiudi = bottone('Chiudi', function () { pannello.style.display = 'none'; });

        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json,text/plain,.txt';
        css(input, { display: 'none' });
        input.addEventListener('change', function (e) {
            importaDaFile(e.target.files[0]);
            e.target.value = '';
        });

        [btnIndietro, btnCopia, btnAvanti, btnFile, btnChiudi].forEach(function (b) {
            riga.appendChild(b);
        });

        pannello.appendChild(info);
        pannello.appendChild(area);
        pannello.appendChild(riga);
        pannello.appendChild(input);
        document.body.appendChild(pannello);

        collegaAperture();
        window.travaso = { apri: apriPannello };
    }

    function bottone(testo, azione) {
        var b = document.createElement('button');
        b.textContent = testo;
        css(b, {
            flex: '1 1 auto', minWidth: '90px', padding: '10px 8px', border: '0',
            borderRadius: '6px', background: '#3a6ea5', color: '#fff',
            fontSize: '14px', cursor: 'pointer'
        });
        b.addEventListener('click', azione);
        return b;
    }

    function apriPannello() {
        pannello.style.display = 'block';
        info.textContent = 'Sto leggendo i dati...';
        raccogli().then(function (dati) {
            var testo = JSON.stringify(dati);
            stato.nome = dati.app;
            return sha256hex(testo).then(function (h) {
                stato.impronta = h;
                stato.pezzi = dividi(testo);
                stato.indice = 0;
                var nChiavi = Object.keys(dati.chiavi).length;
                var righe = 0;
                Object.keys(dati.database || {}).forEach(function (d) {
                    var arch = dati.database[d].archivi || {};
                    Object.keys(arch).forEach(function (a) { righe += (arch[a].righe || []).length; });
                });
                info.textContent =
                    'App ' + dati.app + ' — ' + nChiavi + ' chiavi, ' +
                    righe + ' righe di database, ' +
                    (testo.length / 1048576).toFixed(2) + ' MB, ' +
                    stato.pezzi.length + ' pezzi. Impronta ' + h.slice(0, 12) + '.';
                mostra();
            });
        });
    }

    function intestazione(i) {
        return MARCA + ' ' + (i + 1) + '/' + stato.pezzi.length + ' ' +
               stato.impronta.slice(0, 12) + ' ' + stato.nome;
    }

    function mostra() {
        area.value = intestazione(stato.indice) + '\n' + stato.pezzi[stato.indice];
        btnCopia.textContent = 'Copia pezzo ' + (stato.indice + 1) + '/' + stato.pezzi.length;
        btnIndietro.disabled = stato.indice === 0;
        btnAvanti.disabled = stato.indice >= stato.pezzi.length - 1;
    }

    function vaiA(i) {
        if (i < 0 || i >= stato.pezzi.length) return;
        stato.indice = i;
        mostra();
    }

    function copiaCorrente() {
        area.focus();
        area.select();
        area.setSelectionRange(0, area.value.length);
        var fatto = false;
        try { fatto = document.execCommand('copy'); } catch (e) { fatto = false; }
        var etichetta = 'pezzo ' + (stato.indice + 1) + '/' + stato.pezzi.length;
        if (fatto) {
            btnCopia.textContent = 'copiato ' + etichetta;
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(area.value).then(
                function () { btnCopia.textContent = 'copiato ' + etichetta; },
                function () { btnCopia.textContent = 'copia a mano ' + etichetta; }
            );
        } else {
            btnCopia.textContent = 'copia a mano ' + etichetta;
        }
    }

    // --- rientro ---------------------------------------------------------

    // Riscrive i database: stessi archivi, stesse righe.
    //
    // ⚠️ Non si alza la versione se non serve. Cambiare versione obbliga a
    // passare da onupgradeneeded, che aspetta che NESSUNO tenga il database
    // aperto: ma l'app che ospita questo modulo lo tiene aperto di suo, quindi
    // resterebbe bloccata per sempre. Si alza solo se manca davvero un
    // archivio, e in quel caso si dice all'utente cosa fare.
    function apriDb(nome, versione) {
        return new Promise(function (risolvi, rifiuta) {
            var req = versione ? indexedDB.open(nome, versione) : indexedDB.open(nome);
            req.onupgradeneeded = function () { risolvi({ db: req.result, upgrade: true, req: req }); };
            req.onblocked = function () {
                rifiuta('il database ' + nome + ' e\' tenuto aperto: chiudi e riapri l\'app');
            };
            req.onerror = function () { rifiuta('apertura di ' + nome + ' fallita'); };
            req.onsuccess = function () { risolvi({ db: req.result, upgrade: false }); };
        });
    }

    function scriviUnDb(nomeDb, spec) {
        var archivi = spec.archivi || {};
        var voluti = Object.keys(archivi);
        if (!voluti.length) return Promise.resolve(0);

        return apriDb(nomeDb).then(function (res) {
            var db = res.db;
            var presenti = Array.prototype.slice.call(db.objectStoreNames);
            var mancanti = voluti.filter(function (n) { return presenti.indexOf(n) === -1; });
            if (!mancanti.length) return db;

            // Qualche archivio non c'e': serve un aggiornamento di versione.
            var nuova = db.version + 1;
            db.close();
            return new Promise(function (risolvi, rifiuta) {
                var req = indexedDB.open(nomeDb, nuova);
                req.onupgradeneeded = function () {
                    var d = req.result;
                    mancanti.forEach(function (nome) {
                        var meta = archivi[nome].meta || {};
                        d.createObjectStore(nome, {
                            keyPath: meta.keyPath === undefined ? null : meta.keyPath,
                            autoIncrement: !!meta.autoIncrement
                        });
                    });
                };
                req.onblocked = function () {
                    rifiuta('il database ' + nomeDb + ' e\' tenuto aperto da un\'altra scheda');
                };
                req.onerror = function () { rifiuta('creazione archivi in ' + nomeDb + ' fallita'); };
                req.onsuccess = function () { risolvi(req.result); };
            });
        }).then(function (db) {
            return new Promise(function (risolvi, rifiuta) {
                var scritte = 0;
                var tx = db.transaction(voluti, 'readwrite');
                voluti.forEach(function (nome) {
                    var st = tx.objectStore(nome);
                    st.clear();
                    (archivi[nome].righe || []).forEach(function (r) {
                        st.put(r);
                        scritte++;
                    });
                });
                tx.oncomplete = function () { db.close(); risolvi(scritte); };
                tx.onerror = function () { db.close(); rifiuta('scrittura in ' + nomeDb + ' fallita'); };
            });
        });
    }

    function scriviDatabase(database) {
        var nomi = Object.keys(database || {});
        if (!nomi.length) return Promise.resolve(0);
        var totale = 0;
        return nomi.reduce(function (catena, nomeDb) {
            return catena
                .then(function () { return scriviUnDb(nomeDb, database[nomeDb]); })
                .then(function (n) { totale += n; });
        }, Promise.resolve()).then(function () { return totale; });
    }

    function importaDaFile(file) {
        if (!file) return;
        var r = new FileReader();
        r.onload = function () {
            var dati;
            try {
                dati = JSON.parse(String(r.result).trim());
            } catch (e) {
                info.textContent = 'Rientro fallito: il file non e\' JSON valido.';
                return;
            }
            if (!dati || typeof dati.chiavi !== 'object') {
                info.textContent = 'Rientro fallito: manca il blocco delle chiavi.';
                return;
            }
            var nomi = Object.keys(dati.chiavi);
            if (!confirm('Scrivere ' + nomi.length + ' chiavi di ' + dati.app + '?\n\n' +
                         'Sostituisce quello che c\'e\' adesso in questa app.')) return;
            try {
                nomi.forEach(function (k) { localStorage.setItem(k, dati.chiavi[k]); });
            } catch (e) {
                info.textContent = 'Rientro fallito durante la scrittura: ' + e.message;
                return;
            }
            info.textContent = 'Scritte ' + nomi.length + ' chiavi. Ora i database...';
            scriviDatabase(dati.database || {}).then(function (righe) {
                info.textContent = 'Scritte ' + nomi.length + ' chiavi e ' + righe + ' righe. Ricarico...';
                setTimeout(function () { location.reload(); }, 900);
            }, function (err) {
                info.textContent = 'Chiavi scritte, ma i database no: ' + err;
            });
        };
        r.onerror = function () { info.textContent = 'Rientro fallito: file illeggibile.'; };
        r.readAsText(file);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', costruisci);
    } else {
        costruisci();
    }
})();
