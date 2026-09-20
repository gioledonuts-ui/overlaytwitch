-- ============================================================
--  7GIONNY - Lancement auto du pont au demarrage d'OBS
-- ============================================================
--  Quand OBS demarre, ce script lance automatiquement :
--    1. le pont (le petit serveur qui affiche l'overlay)
--    2. la mini-application (icone dans la barre systeme)
--
--  Tu n'as RIEN d'autre a faire : lance OBS normalement,
--  et tout se met en route tout seul.
--
--  Si ca ne marche pas, le journal de script (Outils > Scripts,
--  onglet "Journal de script") dit exactement ce qui cloche :
--  chaque etape y est ecrite en clair.
-- ============================================================

local obs = obslua

function script_description()
	return [[
	<h2>7GIONNY — Lancement auto du pont</h2>
	<p>Au démarrage d'OBS, ce script lance automatiquement :</p>
	<ul>
		<li>le <b>pont</b> (le serveur de l'overlay)</li>
		<li>la <b>mini-application</b> (icône dans la barre système)</li>
	</ul>
	<p>Tu peux laisser OBS se lancer normalement, tout se met en route tout seul.</p>
	<p><b>Important :</b> ce script doit rester <b>dans le dossier de l'overlay</b>,
	à côté de <i>lancer-app.vbs</i>. Si tu déplaces ou renommes le dossier, retire
	le script dans Outils &gt; Scripts puis rajoute-le depuis son nouvel emplacement.</p>
	]]
end

local function log(msg)
	obs.script_log(obs.LOG_INFO, msg)
end

-- Retourne le dossier qui contient ce script (avec le separateur a la fin)
local function dossier_du_script()
	local p = script_path()
	if not p or p == "" then return nil end
	-- au cas ou script_path() renverrait le chemin complet du fichier :
	if p:match("%.lua$") then
		p = p:match("^(.*[/\\])") or p
	end
	if not p:match("[/\\]$") then
		p = p .. "\\"
	end
	return p
end

-- Windows n'aime pas melanger / et \ dans une commande : on uniformise.
local function en_chemin_windows(p)
	return (p:gsub("/", "\\"))
end

local function fichier_existe(chemin)
	local f = io.open(chemin, "r")
	if f then f:close() return true end
	return false
end

function script_load(settings)
	local dossier = dossier_du_script()

	-- 1. OBS n'a pas su dire ou est le script (entree fantome dans Outils > Scripts).
	if not dossier then
		obs.script_log(obs.LOG_WARNING,
			"Impossible de trouver le dossier du script. Retire-le dans Outils > Scripts, " ..
			"puis rajoute-le depuis le dossier de l'overlay.")
		return
	end

	log("Dossier de l'overlay : " .. dossier)

	-- 2. Le script est bien charge, mais pas au bon endroit : on le dit clairement
	--    au lieu de lancer une commande qui echouerait sans explication.
	-- on teste la presence sur le chemin tel que l'a donne OBS (io.open accepte
	-- les deux separateurs), et on ne passe en antislash que pour la commande.
	local vbs_test = dossier .. "lancer-app.vbs"
	local vbs = en_chemin_windows(vbs_test)
	if not fichier_existe(vbs_test) then
		obs.script_log(obs.LOG_WARNING,
			"Fichier introuvable : " .. vbs ..
			"  -->  ce script doit rester DANS le dossier de l'overlay, a cote de lancer-app.vbs. " ..
			"Si tu as deplace ou renomme le dossier : Outils > Scripts, retire la ligne " ..
			"demarrer-avec-obs.lua (bouton -), puis rajoute-la (bouton +) depuis le nouveau dossier.")
		return
	end

	-- 3. Tout est en place : on lance la mini-app, sans aucune fenetre.
	--    Les guillemets autour du chemin sont indispensables (dossier "Mes documents",
	--    "OneDrive - ...", bref des le moindre espace).
	local cmd = 'start "" wscript.exe "' .. vbs .. '"'
	log("Lancement de la mini-app 7G : " .. cmd)
	local ok = os.execute(cmd)
	if ok == false then
		obs.script_log(obs.LOG_WARNING,
			"Le lancement a echoue. Lance l'overlay a la main avec lancer-tout.bat, " ..
			"et verifie que ton antivirus ne bloque pas wscript.exe.")
	end
end
