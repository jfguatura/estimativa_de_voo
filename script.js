let mapa;
let aeroportos = [];
let marcadores = [];
let linhaVoo;
let dadosTrajeto = null;

// Versão consolidada da função carregarDadosAeroportos
async function carregarDadosAeroportos() {
  try {
    // Verificar cache primeiro
    const cache = localStorage.getItem('aeroportosCache');
    const cacheDate = localStorage.getItem('aeroportosCacheDate');
    
    if (cache && cacheDate && (Date.now() - new Date(cacheDate).getTime() < 7 * 24 * 60 * 60 * 1000)) {
      aeroportos = JSON.parse(cache);
      inicializarMapa();
      preencherMunicipios();
      return;
    }

    showLoading('Carregando dados de aeroportos...');
    
    // Carregar dados brasileiros e internacionais em paralelo
    const [dadosBr, dadosInt] = await Promise.all([
      fetch("AerodromosPublicos.json").then(r => r.ok ? r.json() : Promise.reject('Falha ao carregar dados brasileiros')),
      fetch("https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv")
        .then(r => r.ok ? r.text() : Promise.reject('Falha ao carregar dados internacionais'))
    ]);
    
    // Processar e combinar dados
    aeroportos = [
      ...processarAeroportosBrasileiros(dadosBr),
      ...processarAeroportosInternacionais(parseCsv(dadosInt))
    ].filter(a => !isNaN(a.latitude) && !isNaN(a.longitude));
    
    // Salvar no cache
    localStorage.setItem('aeroportosCache', JSON.stringify(aeroportos));
    localStorage.setItem('aeroportosCacheDate', new Date().toISOString());
    
    mostrarDataAtualizacao(new Date().toISOString());
    inicializarMapa();
    preencherMunicipios();
    
    showMessage('Dados carregados com sucesso!', 'success');
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

// Parser CSV mais robusto
function parseCsv(csv) {
  const lines = csv.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1).map(line => {
    const result = {};
    let current = '';
    let insideQuotes = false;
    let headerIndex = 0;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result[headers[headerIndex]] = current.trim();
        current = '';
        headerIndex++;
      } else {
        current += char;
      }
    }
    
    // Adicionar o último campo
    if (current.trim() !== '' || headerIndex < headers.length) {
      result[headers[headerIndex]] = current.trim();
    }
    
    return result;
  });
}

// Função filtrarAeroportos que estava faltando
function filtrarAeroportos() {
  const pais = document.getElementById("filtro-pais").value;
  const tipo = document.getElementById("filtro-tipo").value;
  
  marcadores.forEach(m => mapa.removeLayer(m));
  marcadores = [];
  
  const aeroportosFiltrados = aeroportos.filter(a => {
    return (!pais || a.pais === pais) && 
           (!tipo || a.tipo.includes(tipo));
  });
  
  aeroportosFiltrados.forEach(aero => {
    const marcador = L.marker([aero.latitude, aero.longitude])
      .bindPopup(gerarPopup(aero))
      .addTo(mapa);
    marcadores.push(marcador);
  });
  
  if (aeroportosFiltrados.length > 0) {
    const grupo = new L.featureGroup(marcadores);
    mapa.fitBounds(grupo.getBounds());
  }
}

function processarAeroportosBrasileiros(dados) {
  return dados.map(a => ({
    codigo_oaci: a["CódigoOACI"],
    codigo_iata: a["CódigoIATA"] || '',
    ciad: a["CIAD"],
    nome: a["Nome"],
    municipio: a["Município"],
    uf: a["UF"],
    municipio_servido: a["MunicípioServido"],
    uf_servido: a["UFSERVIDO"],
    latitude: parseFloat(a["LatGeoPoint"]),
    longitude: parseFloat(a["LonGeoPoint"]),
    latitude_gms: a["Latitude"],
    longitude_gms: a["Longitude"],
    altitude: a["Altitude"],
    pais: 'Brasil',
    tipo: 'public',
    continente: 'América do Sul'
  }));
}

function processarAeroportosInternacionais(dados) {
  return dados.filter(a => a.type === 'medium_airport' || a.type === 'large_airport')
    .map(a => ({
      codigo_oaci: a.ident || '',
      codigo_iata: a.iata_code || '',
      nome: a.name,
      municipio: a.municipality || '',
      uf: a.region || '',
      latitude: parseFloat(a.latitude_deg),
      longitude: parseFloat(a.longitude_deg),
      altitude: a.elevation_ft ? `${Math.round(a.elevation_ft * 0.3048)}m` : '',
      pais: a.iso_country === 'BR' ? 'Brasil' : a.iso_country,
      tipo: a.type,
      continente: a.continent
    }));
}

function obterAeroportoPorCodigo(codigo) {
  return aeroportos.find(a => 
    a.codigo_oaci === codigo || 
    a.codigo_iata === codigo
  );
}

function mostrarDataAtualizacao(dataModificacao) {
  const el = document.getElementById("data-atualizacao");
  if (dataModificacao) {
    const data = new Date(dataModificacao);
    const dataFormatada = data.toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    el.textContent = `Data de atualização: ${dataFormatada}`;
  } else {
    el.textContent = `Data de atualização: não disponível`;
  }
}

let markerCluster;

function inicializarMapa() {
  mapa = L.map('map').setView([-15.78, -47.93], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapa);

  // Inicializa o cluster de marcadores
  markerCluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 80
  });
  mapa.addLayer(markerCluster);

  exibirTodosOsAeroportos();
}

function exibirTodosOsAeroportos() {
  // Limpa os marcadores existentes
  markerCluster.clearLayers();
  marcadores = [];

  // Adiciona todos os aeroportos ao cluster
  aeroportos.forEach(aero => {
    const popupContent = gerarPopup(aero);
    const marcador = L.marker([aero.latitude, aero.longitude])
      .bindPopup(popupContent);
    
    marcadores.push(marcador);
    markerCluster.addLayer(marcador);
  });

  // Ajusta a visualização para mostrar todos os marcadores
  if (marcadores.length > 0) {
    mapa.fitBounds(markerCluster.getBounds());
  }
}

// Funções de UI melhoradas
function showLoading(message = 'Carregando...') {
  const spinner = document.getElementById('loading-spinner');
  const messageEl = document.getElementById('loading-message');
  messageEl.textContent = message;
  spinner.style.display = 'flex';
}

function hideLoading() {
  const spinner = document.getElementById('loading-spinner');
  spinner.style.display = 'none';
}

function showError(message) {
  showMessage(message, 'error');
  console.error(message);
}


function gerarPopup(aero) {
  let conteudo = `<strong>${aero.nome}</strong><br>`;
  for (const [chave, valor] of Object.entries(aero)) {
    if (valor && !['latitude', 'longitude', 'nome'].includes(chave)) {
      const chaveFormatada = chave.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      conteudo += `<strong>${chaveFormatada}:</strong> ${valor}<br>`;
    }
  }
  return conteudo;
}

function preencherMunicipios() {
  // Agrupa municípios brasileiros e cidades internacionais
  const localidades = [...new Set(aeroportos.map(a => {
    if (a.pais === 'Brasil') {
      return `${a.municipio} (${a.uf})`;
    } else {
      return `${a.municipio || a.nome.split(' ')[0]} - ${a.pais}`;
    }
  }))].sort((a, b) => a.localeCompare(b));

  const selectOrigem = document.getElementById("municipio-origem");
  const selectDestino = document.getElementById("municipio-destino");

  // Limpa os selects antes de preencher
  selectOrigem.innerHTML = '<option value="">Selecione uma localidade</option>';
  selectDestino.innerHTML = '<option value="">Selecione uma localidade</option>';

  localidades.forEach(local => {
    selectOrigem.add(new Option(local, local));
    selectDestino.add(new Option(local, local));
  });

  selectOrigem.addEventListener("change", () => filtrarAeroportosPorLocalidade("origem"));
  selectDestino.addEventListener("change", () => filtrarAeroportosPorLocalidade("destino"));
}

function preencherPaises() {
  const paises = [...new Set(aeroportos.map(a => a.pais))].sort();
  const selectPais = document.getElementById("filtro-pais");
  
  selectPais.innerHTML = '<option value="">Todos os países</option>';
  paises.forEach(pais => {
    selectPais.add(new Option(pais, pais));
  });
  
  selectPais.addEventListener("change", filtrarAeroportos);
}

function filtrarAeroportosPorLocalidade(tipo) {
  const localidade = document.getElementById(`municipio-${tipo}`).value;
  const selectAeroporto = document.getElementById(`aeroporto-${tipo}`);
  selectAeroporto.innerHTML = '<option value="">Selecione um aeroporto</option>';

  if (!localidade) return;

  aeroportos
    .filter(a => {
      if (a.pais === 'Brasil') {
        return `${a.municipio} (${a.uf})` === localidade;
      } else {
        return `${a.municipio || a.nome.split(' ')[0]} - ${a.pais}` === localidade;
      }
    })
    .forEach(aero => {
      const label = aero.pais === 'Brasil' 
        ? `${aero.nome} - ${aero.municipio}/${aero.uf} (${aero.codigo_oaci || aero.codigo_iata})`
        : `${aero.nome} - ${aero.pais} (${aero.codigo_iata || aero.codigo_oaci})`;
      
      selectAeroporto.add(new Option(label, aero.codigo_oaci || aero.codigo_iata));
    });
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Cálculo de tempo específico para o VC-2 (Embraer E-190)
function calcularTempoVC2(distancia) {
  const subidaDescida = 268; // km (132 km subida + 136 km descida)
  const cruzeiro = Math.max(0, distancia - subidaDescida);

  const tempoSubidaDescida = subidaDescida / 537; // 537 km/h em subida/descida
  const tempoCruzeiro = cruzeiro / 852; // 852 km/h em cruzeiro

  return tempoSubidaDescida + tempoCruzeiro;
}

// Cálculo de tempo específico para o VC-1 (Airbus A319)
function calcularTempoVC1(distancia) {
  const subidaDescida = 314;
  const cruzeiro = Math.max(0, distancia - subidaDescida);

  const tempoSubidaDescida = subidaDescida / 537;
  const tempoCruzeiro = cruzeiro / 833;

  return tempoSubidaDescida + tempoCruzeiro;
}

// Cálculo de tempo específico para o KC-30 (Airbus A330)
function calcularTempoKC30(distancia) {
  const subidaDescida = 362;
  const cruzeiro = Math.max(0, distancia - subidaDescida);

  const tempoSubidaDescida = subidaDescida / 546;
  const tempoCruzeiro = cruzeiro / 870;

  return tempoSubidaDescida + tempoCruzeiro;
}

// Aguarda o carregamento completo do DOM
document.addEventListener('DOMContentLoaded', function () {
  // Exibir e esconder campo de velocidade personalizada com base na escolha de aeronave
  document.getElementById("aeronave").addEventListener("change", function () {
    const tipo = this.value;
    const customInput = document.getElementById("custom-speed-input");
    customInput.style.display = tipo === "custom" ? "block" : "none";
  });
  
  // Adiciona o listener ao botão "Calcular Trajeto"
  document.getElementById('calcular').addEventListener('click', function () {
    console.log('Botão clicado');
    calcularTrajeto();
  });
  
  // para o botão funcionar ao clicar, é necessário que você adicione um event listener a ele
  document.getElementById("exportar-pdf").addEventListener("click", exportarPDF);
  
function calcularTrajeto() {
  try {
    showLoading('Calculando trajeto...');
    
    const codOrigem = document.getElementById("aeroporto-origem").value;
    const codDestino = document.getElementById("aeroporto-destino").value;
    const tipoVel = document.getElementById("aeronave").value;
    const velCustom = document.getElementById("velocidade-personalizada").value;

    const origem = obterAeroportoPorCodigo(codOrigem);
    const destino = obterAeroportoPorCodigo(codDestino);
    const velocidade = tipoVel === "custom" ? parseFloat(velCustom) : null;

    // Verifica se os aeroportos de origem e destino são válidos
    if (!origem || !destino) {
      throw new Error('Por favor, selecione aeroportos de origem e destino válidos.');
    }

    // Verifica se a velocidade é válida (velocidade agora é um identificador de texto para aeronave)
    if (tipoVel === "custom" && (isNaN(velocidade) || velocidade <= 0)) {
      throw new Error("Por favor, informe uma velocidade válida.");
    }

    // Calcula a distância entre os aeroportos
    const dist = calcularDistancia(origem.latitude, origem.longitude, destino.latitude, destino.longitude);
    
    // Cálculo de tempo com base na aeronave selecionada
    let tempo;
    if (tipoVel === "vc1") {
      tempo = calcularTempoVC1(dist);
    } else if (tipoVel === "vc2") {
      tempo = calcularTempoVC2(dist);
    } else if (tipoVel === "kc30") {
      tempo = calcularTempoKC30(dist);
    } else {
      tempo = dist / velocidade;
    }

    // Remove marcadores anteriores do mapa
    marcadores.forEach(m => mapa.removeLayer(m));
    marcadores = [];

    // Adiciona marcadores para origem e destino no mapa
    const marcadorOrigem = L.marker([origem.latitude, origem.longitude])
      .bindPopup(gerarPopup(origem))
      .addTo(mapa);
    const marcadorDestino = L.marker([destino.latitude, destino.longitude])
      .bindPopup(gerarPopup(destino))
      .addTo(mapa);
    marcadores.push(marcadorOrigem, marcadorDestino);

    // Desenha a linha do voo
    if (linhaVoo) mapa.removeLayer(linhaVoo);
    linhaVoo = L.polyline([
      [origem.latitude, origem.longitude],
      [destino.latitude, destino.longitude]
    ], { color: 'red' }).addTo(mapa);

    // Ajusta o mapa para mostrar a linha de voo
    mapa.fitBounds(linhaVoo.getBounds());

    // Formata os resultados
    const horas = Math.floor(tempo);
    const minutos = Math.round((tempo - horas) * 60);
    const tempoFormatado = `${horas}h ${minutos}min`;
    const distanciaFormatada = Math.round(dist).toLocaleString('pt-BR');

    // Salva os dados do trajeto para uso posterior (ex: exportar PDF)
    dadosTrajeto = {
      aeronave: document.getElementById("aeronave").selectedOptions[0].text,
      origem,
      destino,
      distancia: Math.round(dist),
      tempoHoras: Math.floor(tempo),
      tempoMinutos: Math.round((tempo - Math.floor(tempo)) * 60)
    };

    // Usa dadosTrajeto no popup da linha de voo
    linhaVoo.bindPopup(
      `<strong>${dadosTrajeto.aeronave}</strong><br>
       <strong>Distância:</strong> ${distanciaFormatada} km<br>
       <strong>Tempo estimado:</strong> ${tempoFormatado}`
    ).openPopup();

    showMessage('Trajeto calculado com sucesso!', 'success');
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

  // Adicione animação ao exibir resultados
  function exibirResultadoTrajeto(dados) {
    const popupContent = `
      <div class="fade-in">
        <strong>${dados.aeronave}</strong><br>
        <strong>Distância:</strong> ${dados.distancia.toLocaleString('pt-BR')} km<br>
        <strong>Tempo estimado:</strong> ${dados.tempoHoras}h ${dados.tempoMinutos}min
      </div>
    `;
    
    linhaVoo.bindPopup(popupContent).openPopup();
  }
  
  // Função para obter informações do aeroporto por código
 function obterAeroportoPorCodigo(codigo) {
  return aeroportos.find(aeroporto => aeroporto.codigo_oaci === codigo);
  }
});

async function exportarPDF() {
  if (!dadosTrajeto) {
    alert("Você precisa calcular o trajeto antes de exportar o PDF.");
    return;
  }

  // Preenche o painel lateral com dados formatados
  const { aeronave, origem, destino, distancia, tempoHoras, tempoMinutos } = dadosTrajeto;

  const painel = document.getElementById("export-left-panel");
  painel.innerHTML = `
    <h2>Plano de Voo</h2>
    <p><strong>Aeronave:</strong> ${aeronave}</p>
    <p><strong>Origem:</strong><br>${origem.nome} (${origem.codigo_oaci})<br>${origem.municipio}/${origem.uf}</p>
    <p><strong>Destino:</strong><br>${destino.nome} (${destino.codigo_oaci})<br>${destino.municipio}/${destino.uf}</p>
    <p><strong>Distância:</strong> ${distancia.toLocaleString("pt-BR")} km</p>
    <p><strong>Tempo estimado:</strong> ${tempoHoras}h${tempoMinutos}min</p>
  `;

  // Exibe temporariamente o container com o mapa original visível
  const exportContainer = document.getElementById("export-container");
  exportContainer.style.display = "flex";

  // Captura imagem do container visível (painel + mapa real)
  const canvas = await html2canvas(exportContainer, {
    useCORS: true,
    scale: 1,
    logging: false
  });
  
  // Aguarda renderização dos tiles do mapa
  await new Promise(resolve => setTimeout(resolve, 500));  // 0.5s para garantir renderização do mapa

  
  // Clona o conteúdo do mapa
  // const originalMap = document.getElementById("map");
  // const exportMap = document.getElementById("export-map");
  // exportMap.innerHTML = ""; // limpa o mapa anterior, se houver
  // exportMap.appendChild(originalMap.cloneNode(true));

  // Exibe temporariamente o container
  // const exportContainer = document.getElementById("export-container");
  // exportContainer.style.display = "flex";

  // Captura imagem do container completo
  // const canvas = await html2canvas(exportContainer, {
  //   useCORS: true,
  //   scale: 2
  // });

  const imgData = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth;
  const imgHeight = canvas.height * imgWidth / canvas.width;

  pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
  pdf.save(`plano_voo_${origem.codigo_oaci}_${destino.codigo_oaci}.pdf`);

  // Oculta novamente
  exportContainer.style.display = "none";
}

carregarDadosAeroportos();
