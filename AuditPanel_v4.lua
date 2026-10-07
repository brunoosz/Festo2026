--[[
    ╔══════════════════════════════════════════════════╗
    ║          AUDIT PANEL v4.0 - Security Script      ║
    ║  Jogo: Roube um Ovo  |  Executor: Xeno           ║
    ║  Abas: VISUALS | MOVEMENT | AIMBOT               ║
    ║  HP Vertical | Visibilidade | AlwaysOn | AntiTP   ║
    ╚══════════════════════════════════════════════════╝
]]

-- ══════════════════════════════════════════
--  SERVIÇOS
-- ══════════════════════════════════════════
local Players     = game:GetService("Players")
local RunService  = game:GetService("RunService")
local UserInput   = game:GetService("UserInputService")
local TweenSvc    = game:GetService("TweenService")
local Camera      = workspace.CurrentCamera
local LocalPlayer = Players.LocalPlayer

-- ══════════════════════════════════════════
--  CONFIG
-- ══════════════════════════════════════════
local CONFIG = {
    ESP = {
        ColorVisible   = Color3.fromRGB(50, 220, 80),
        ColorHidden    = Color3.fromRGB(255, 50, 50),
        OutlineColor   = Color3.fromRGB(255, 255, 255),
        FillTrans      = 0.82,
        MaxDist        = 1000,
        ShowNames      = true,
        ShowDistance    = true,
        ShowHealth     = true,
    },
    Fly = {
        Speed          = 60,
    },
    Speed = {
        Value          = 50,
    },
    Aimbot = {
        Bind           = { isMouse = true,  value = Enum.UserInputType.MouseButton2 },
        AlwaysActive   = false,
        FOV            = 150,
        Smoothness     = 0.25,
        TargetPart     = "Head",
        OnlyVisible    = true,
    },
    Triggerbot = {
        Bind           = { isMouse = false, value = Enum.KeyCode.CapsLock },
        AlwaysActive   = false,
        Delay          = 0.06,
        OnlyVisible    = true,
    },
    GUI = {
        Bg           = Color3.fromRGB(13, 13, 19),
        Panel        = Color3.fromRGB(22, 22, 32),
        Accent       = Color3.fromRGB(108, 60, 230),
        TabActive    = Color3.fromRGB(108, 60, 230),
        TabInactive  = Color3.fromRGB(35, 35, 50),
        Text         = Color3.fromRGB(225, 225, 225),
        SubText      = Color3.fromRGB(140, 140, 160),
        ToggleOn     = Color3.fromRGB(70, 200, 110),
        ToggleOff    = Color3.fromRGB(58, 58, 72),
    },
}

-- ══════════════════════════════════════════
--  ESTADO GLOBAL
-- ══════════════════════════════════════════
local State = {
    ESP        = false,
    Fly        = false,
    Speed      = false,
    Aimbot     = false,
    Triggerbot = false,
    NoReload   = false,
    Minimized  = false,
    ActiveTab  = "VISUALS",
}

local EspObjects       = {}
local VisibilityCache  = {}
local FlyObjects       = { conn = nil, lastPos = nil, anchor = nil }
local SpeedObjects     = { conn = nil, lastPos = nil }
local lastTriggerTick  = 0

local enableFly, disableFly
local enableSpeed, disableSpeed

-- ══════════════════════════════════════════
--  UTILITÁRIOS DE TECLAS
-- ══════════════════════════════════════════
local function isBindPressed(bind)
    if not bind then return false end
    if bind.isMouse then
        return UserInput:IsMouseButtonPressed(bind.value)
    else
        return UserInput:IsKeyDown(bind.value)
    end
end

local function getBindName(bind)
    if not bind then return "Nenhum" end
    if bind.isMouse then
        if bind.value == Enum.UserInputType.MouseButton1 then return "M1 (Esq)" end
        if bind.value == Enum.UserInputType.MouseButton2 then return "M2 (Dir)" end
        if bind.value == Enum.UserInputType.MouseButton3 then return "M3 (Meio)" end
        return "Mouse?"
    else
        local name = tostring(bind.value):gsub("Enum%.KeyCode%.", "")
        return name
    end
end

local function hpToColor(ratio)
    local r = math.floor(ratio > 0.5
        and (1 - ratio) * 2 * 200
        or  200)
    local g = math.floor(ratio > 0.5
        and 200
        or  ratio * 2 * 200)
    return Color3.fromRGB(r, g, 35)
end

-- ══════════════════════════════════════════
--  CHECK DE VISIBILIDADE (raycast)
-- ══════════════════════════════════════════
local function isPlayerVisible(targetChar)
    local myChar = LocalPlayer.Character
    if not myChar or not targetChar then return false end
    local myHead = myChar:FindFirstChild("Head")
    local targetHead = targetChar:FindFirstChild("Head")
    local targetHRP = targetChar:FindFirstChild("HumanoidRootPart")
    if not myHead or not (targetHead or targetHRP) then return false end

    local origin = myHead.Position
    local targetPart = targetHead or targetHRP
    local direction = (targetPart.Position - origin)

    local rp = RaycastParams.new()
    rp.FilterDescendantsInstances = { myChar, targetChar }
    rp.FilterType = Enum.RaycastFilterType.Exclude

    local result = workspace:Raycast(origin, direction, rp)
    return result == nil
end

-- ══════════════════════════════════════════
--  LIMPAR GUI ANTERIOR
-- ══════════════════════════════════════════
pcall(function()
    if game.CoreGui:FindFirstChild("AuditPanel_v4") then
        game.CoreGui.AuditPanel_v4:Destroy()
    end
end)

-- ══════════════════════════════════════════
--  RAIZ
-- ══════════════════════════════════════════
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name           = "AuditPanel_v4"
ScreenGui.ResetOnSpawn   = false
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
ScreenGui.Parent         = game.CoreGui

local Win = Instance.new("Frame")
Win.Name             = "Window"
Win.Size             = UDim2.new(0, 290, 0, 450)
Win.Position         = UDim2.new(0, 40, 0.5, -225)
Win.BackgroundColor3 = CONFIG.GUI.Bg
Win.BorderSizePixel  = 0
Win.ClipsDescendants = true
Win.Parent           = ScreenGui
Instance.new("UICorner", Win).CornerRadius = UDim.new(0, 10)

local WinStroke = Instance.new("UIStroke")
WinStroke.Color       = CONFIG.GUI.Accent
WinStroke.Thickness   = 1.2
WinStroke.Transparency = 0.45
WinStroke.Parent      = Win

-- ══════════════════════════════════════════
--  BARRA DE TÍTULO
-- ══════════════════════════════════════════
local TitleBar = Instance.new("Frame")
TitleBar.Name            = "TitleBar"
TitleBar.Size            = UDim2.new(1, 0, 0, 38)
TitleBar.BackgroundColor3 = CONFIG.GUI.Accent
TitleBar.BorderSizePixel = 0
TitleBar.ZIndex          = 5
TitleBar.Parent          = Win
Instance.new("UICorner", TitleBar).CornerRadius = UDim.new(0, 10)

do
    local f = Instance.new("Frame")
    f.Size             = UDim2.new(1, 0, 0.5, 0)
    f.Position         = UDim2.new(0, 0, 0.5, 0)
    f.BackgroundColor3 = CONFIG.GUI.Accent
    f.BorderSizePixel  = 0
    f.ZIndex           = 4
    f.Parent           = TitleBar
end

local TitleLbl = Instance.new("TextLabel")
TitleLbl.Text             = "  Audit Panel  v4.0"
TitleLbl.Size             = UDim2.new(1, -75, 1, 0)
TitleLbl.BackgroundTransparency = 1
TitleLbl.TextColor3       = Color3.new(1, 1, 1)
TitleLbl.Font             = Enum.Font.GothamBold
TitleLbl.TextSize         = 13
TitleLbl.TextXAlignment   = Enum.TextXAlignment.Left
TitleLbl.ZIndex           = 6
TitleLbl.Parent           = TitleBar

local MinBtn = Instance.new("TextButton")
MinBtn.Text             = "-"
MinBtn.Size             = UDim2.new(0, 26, 0, 20)
MinBtn.Position         = UDim2.new(1, -58, 0.5, -10)
MinBtn.BackgroundColor3 = Color3.fromRGB(240, 180, 30)
MinBtn.TextColor3       = Color3.new(0, 0, 0)
MinBtn.Font             = Enum.Font.GothamBold
MinBtn.TextSize         = 14
MinBtn.BorderSizePixel  = 0
MinBtn.ZIndex           = 7
MinBtn.Parent           = TitleBar
Instance.new("UICorner", MinBtn).CornerRadius = UDim.new(0, 5)

local CloseBtn = Instance.new("TextButton")
CloseBtn.Text             = "X"
CloseBtn.Size             = UDim2.new(0, 26, 0, 20)
CloseBtn.Position         = UDim2.new(1, -28, 0.5, -10)
CloseBtn.BackgroundColor3 = Color3.fromRGB(215, 45, 45)
CloseBtn.TextColor3       = Color3.new(1, 1, 1)
CloseBtn.Font             = Enum.Font.GothamBold
CloseBtn.TextSize         = 13
CloseBtn.BorderSizePixel  = 0
CloseBtn.ZIndex           = 7
CloseBtn.Parent           = TitleBar
Instance.new("UICorner", CloseBtn).CornerRadius = UDim.new(0, 5)

-- ══════════════════════════════════════════
--  BARRA DE ABAS
-- ══════════════════════════════════════════
local TabBar = Instance.new("Frame")
TabBar.Name             = "TabBar"
TabBar.Size             = UDim2.new(1, 0, 0, 34)
TabBar.Position         = UDim2.new(0, 0, 0, 38)
TabBar.BackgroundColor3 = CONFIG.GUI.Panel
TabBar.BorderSizePixel  = 0
TabBar.Parent           = Win

do
    local tl = Instance.new("UIListLayout")
    tl.FillDirection        = Enum.FillDirection.Horizontal
    tl.HorizontalAlignment  = Enum.HorizontalAlignment.Center
    tl.VerticalAlignment    = Enum.VerticalAlignment.Center
    tl.Padding              = UDim.new(0, 4)
    tl.Parent               = TabBar
    local tp = Instance.new("UIPadding")
    tp.PaddingLeft  = UDim.new(0, 4)
    tp.PaddingRight = UDim.new(0, 4)
    tp.Parent       = TabBar
end

local Divider = Instance.new("Frame")
Divider.Size             = UDim2.new(1, 0, 0, 1)
Divider.Position         = UDim2.new(0, 0, 0, 72)
Divider.BackgroundColor3 = CONFIG.GUI.Accent
Divider.BackgroundTransparency = 0.55
Divider.BorderSizePixel  = 0
Divider.Parent           = Win

-- ══════════════════════════════════════════
--  CRIAR SCROLL CONTENT DE ABA
-- ══════════════════════════════════════════
local function makeTab()
    local sf = Instance.new("ScrollingFrame")
    sf.Size               = UDim2.new(1, 0, 1, -75)
    sf.Position           = UDim2.new(0, 0, 0, 75)
    sf.BackgroundTransparency = 1
    sf.BorderSizePixel    = 0
    sf.ScrollBarThickness = 3
    sf.ScrollBarImageColor3 = CONFIG.GUI.Accent
    sf.CanvasSize         = UDim2.new(0, 0, 0, 0)
    sf.AutomaticCanvasSize = Enum.AutomaticSize.Y
    sf.Visible            = false
    sf.Parent             = Win

    local layout = Instance.new("UIListLayout")
    layout.Padding             = UDim.new(0, 7)
    layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
    layout.SortOrder           = Enum.SortOrder.LayoutOrder
    layout.Parent              = sf

    local pad = Instance.new("UIPadding")
    pad.PaddingTop    = UDim.new(0, 10)
    pad.PaddingBottom = UDim.new(0, 14)
    pad.PaddingLeft   = UDim.new(0, 10)
    pad.PaddingRight  = UDim.new(0, 10)
    pad.Parent        = sf

    return sf
end

local Tabs = {
    VISUALS  = makeTab(),
    MOVEMENT = makeTab(),
    AIMBOT   = makeTab(),
}

-- ══════════════════════════════════════════
--  BOTÕES DE ABA
-- ══════════════════════════════════════════
local TabBtns  = {}
local tabList  = { "VISUALS", "MOVEMENT", "AIMBOT" }
local tabIcons = { "ESP", "MOVE", "AIM" }

local function refreshTabs()
    for name, btn in pairs(TabBtns) do
        local on = (name == State.ActiveTab)
        TweenSvc:Create(btn, TweenInfo.new(0.14), {
            BackgroundColor3 = on and CONFIG.GUI.TabActive or CONFIG.GUI.TabInactive,
            TextColor3       = on and Color3.new(1,1,1) or CONFIG.GUI.SubText,
        }):Play()
        Tabs[name].Visible = on
    end
end

for i, name in ipairs(tabList) do
    local btn = Instance.new("TextButton")
    btn.Text             = tabIcons[i] .. " " .. name
    btn.Size             = UDim2.new(0, 82, 0, 26)
    btn.BackgroundColor3 = CONFIG.GUI.TabInactive
    btn.TextColor3       = CONFIG.GUI.SubText
    btn.Font             = Enum.Font.GothamBold
    btn.TextSize         = 11
    btn.BorderSizePixel  = 0
    btn.Parent           = TabBar
    Instance.new("UICorner", btn).CornerRadius = UDim.new(0, 6)
    btn.MouseButton1Click:Connect(function()
        State.ActiveTab = name
        refreshTabs()
    end)
    TabBtns[name] = btn
end

State.ActiveTab = "VISUALS"
refreshTabs()

-- ══════════════════════════════════════════
--  FOV CIRCLE
-- ══════════════════════════════════════════
local FovCircle = Drawing.new("Circle")
FovCircle.Visible      = false
FovCircle.Thickness    = 1.5
FovCircle.Color        = Color3.fromRGB(255, 255, 255)
FovCircle.Filled       = false
FovCircle.NumSides     = 64
FovCircle.Radius       = CONFIG.Aimbot.FOV
FovCircle.Position     = Vector2.new(Camera.ViewportSize.X/2, Camera.ViewportSize.Y/2)
FovCircle.Transparency = 1

-- ══════════════════════════════════════════
--  COMPONENTES DA GUI
-- ══════════════════════════════════════════
local TI = TweenInfo.new(0.14, Enum.EasingStyle.Quad)

local function createToggle(parent, label, sublabel, defaultOn, order, cb)
    local Row = Instance.new("Frame")
    Row.Size             = UDim2.new(1, 0, 0, sublabel and 50 or 38)
    Row.BackgroundColor3 = CONFIG.GUI.Panel
    Row.BorderSizePixel  = 0
    Row.LayoutOrder      = order or 0
    Row.Parent           = parent
    Instance.new("UICorner", Row).CornerRadius = UDim.new(0, 8)

    local Lbl = Instance.new("TextLabel")
    Lbl.Text             = label
    Lbl.Size             = UDim2.new(1, -58, 0, 20)
    Lbl.Position         = UDim2.new(0, 10, 0, sublabel and 6 or 9)
    Lbl.BackgroundTransparency = 1
    Lbl.TextColor3       = CONFIG.GUI.Text
    Lbl.Font             = Enum.Font.Gotham
    Lbl.TextSize         = 13
    Lbl.TextXAlignment   = Enum.TextXAlignment.Left
    Lbl.Parent           = Row

    if sublabel then
        local Sub = Instance.new("TextLabel")
        Sub.Text           = sublabel
        Sub.Size           = UDim2.new(1, -58, 0, 13)
        Sub.Position       = UDim2.new(0, 10, 0, 28)
        Sub.BackgroundTransparency = 1
        Sub.TextColor3     = CONFIG.GUI.SubText
        Sub.Font           = Enum.Font.Gotham
        Sub.TextSize       = 10
        Sub.TextXAlignment = Enum.TextXAlignment.Left
        Sub.TextWrapped    = true
        Sub.Parent         = Row
    end

    local Track = Instance.new("Frame")
    Track.Size             = UDim2.new(0, 42, 0, 22)
    Track.Position         = UDim2.new(1, -52, 0.5, -11)
    Track.BackgroundColor3 = defaultOn and CONFIG.GUI.ToggleOn or CONFIG.GUI.ToggleOff
    Track.BorderSizePixel  = 0
    Track.Parent           = Row
    Instance.new("UICorner", Track).CornerRadius = UDim.new(1, 0)

    local Knob = Instance.new("Frame")
    Knob.Size             = UDim2.new(0, 16, 0, 16)
    Knob.Position         = defaultOn and UDim2.new(1,-19,0.5,-8) or UDim2.new(0,3,0.5,-8)
    Knob.BackgroundColor3 = Color3.new(1, 1, 1)
    Knob.BorderSizePixel  = 0
    Knob.Parent           = Track
    Instance.new("UICorner", Knob).CornerRadius = UDim.new(1, 0)

    local isOn = defaultOn or false
    Row.InputBegan:Connect(function(inp)
        if inp.UserInputType == Enum.UserInputType.MouseButton1 then
            isOn = not isOn
            TweenSvc:Create(Track, TI, { BackgroundColor3 = isOn and CONFIG.GUI.ToggleOn or CONFIG.GUI.ToggleOff }):Play()
            TweenSvc:Create(Knob,  TI, { Position = isOn and UDim2.new(1,-19,0.5,-8) or UDim2.new(0,3,0.5,-8) }):Play()
            if cb then cb(isOn) end
        end
    end)
    return Row
end

local function createSection(parent, text, order)
    local F = Instance.new("Frame")
    F.Size             = UDim2.new(1, 0, 0, 20)
    F.BackgroundTransparency = 1
    F.LayoutOrder      = order or 0
    F.Parent           = parent
    local L = Instance.new("TextLabel")
    L.Text             = text
    L.Size             = UDim2.new(1, 0, 1, 0)
    L.BackgroundTransparency = 1
    L.TextColor3       = CONFIG.GUI.Accent
    L.Font             = Enum.Font.GothamBold
    L.TextSize         = 11
    L.TextXAlignment   = Enum.TextXAlignment.Left
    L.Parent           = F
end

local function createSlider(parent, label, min, max, default, dec, suf, order, cb)
    dec = dec or 0; suf = suf or ""
    local Row = Instance.new("Frame")
    Row.Size             = UDim2.new(1, 0, 0, 58)
    Row.BackgroundColor3 = CONFIG.GUI.Panel
    Row.BorderSizePixel  = 0
    Row.LayoutOrder      = order or 0
    Row.Parent           = parent
    Instance.new("UICorner", Row).CornerRadius = UDim.new(0, 8)

    local topF = Instance.new("Frame")
    topF.Size             = UDim2.new(1, 0, 0, 24)
    topF.Position         = UDim2.new(0, 0, 0, 6)
    topF.BackgroundTransparency = 1
    topF.Parent           = Row

    local Lbl = Instance.new("TextLabel")
    Lbl.Text           = label
    Lbl.Size           = UDim2.new(0.62, 0, 1, 0)
    Lbl.Position       = UDim2.new(0, 10, 0, 0)
    Lbl.BackgroundTransparency = 1
    Lbl.TextColor3     = CONFIG.GUI.Text
    Lbl.Font           = Enum.Font.Gotham
    Lbl.TextSize       = 13
    Lbl.TextXAlignment = Enum.TextXAlignment.Left
    Lbl.Parent         = topF

    local ValLbl = Instance.new("TextLabel")
    ValLbl.Text          = string.format("%." .. dec .. "f", default) .. suf
    ValLbl.Size          = UDim2.new(0.38, -10, 1, 0)
    ValLbl.Position      = UDim2.new(0.62, 0, 0, 0)
    ValLbl.BackgroundTransparency = 1
    ValLbl.TextColor3    = CONFIG.GUI.Accent
    ValLbl.Font          = Enum.Font.GothamBold
    ValLbl.TextSize      = 13
    ValLbl.TextXAlignment = Enum.TextXAlignment.Right
    ValLbl.Parent        = topF

    local TrackBg = Instance.new("Frame")
    TrackBg.Size           = UDim2.new(1, -20, 0, 6)
    TrackBg.Position       = UDim2.new(0, 10, 0, 40)
    TrackBg.BackgroundColor3 = Color3.fromRGB(38, 38, 52)
    TrackBg.BorderSizePixel = 0
    TrackBg.Parent         = Row
    Instance.new("UICorner", TrackBg).CornerRadius = UDim.new(1, 0)

    local pct = (default - min) / (max - min)
    local Fill = Instance.new("Frame")
    Fill.Size             = UDim2.new(pct, 0, 1, 0)
    Fill.BackgroundColor3 = CONFIG.GUI.Accent
    Fill.BorderSizePixel  = 0
    Fill.Parent           = TrackBg
    Instance.new("UICorner", Fill).CornerRadius = UDim.new(1, 0)

    local Knob = Instance.new("Frame")
    Knob.Size             = UDim2.new(0, 14, 0, 14)
    Knob.Position         = UDim2.new(pct, -7, 0.5, -7)
    Knob.BackgroundColor3 = Color3.new(1, 1, 1)
    Knob.BorderSizePixel  = 0
    Knob.Parent           = TrackBg
    Instance.new("UICorner", Knob).CornerRadius = UDim.new(1, 0)

    local current = default
    local sDrag   = false

    local function update(mx)
        local abs = TrackBg.AbsolutePosition
        local sz  = TrackBg.AbsoluteSize
        local r   = math.clamp((mx - abs.X) / sz.X, 0, 1)
        current   = min + (max - min) * r
        Fill.Size = UDim2.new(r, 0, 1, 0)
        Knob.Position = UDim2.new(r, -7, 0.5, -7)
        ValLbl.Text   = string.format("%." .. dec .. "f", current) .. suf
        if cb then cb(current) end
    end

    Knob.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 then sDrag = true end
    end)
    TrackBg.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 then sDrag = true; update(i.Position.X) end
    end)
    UserInput.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 then sDrag = false end
    end)
    UserInput.InputChanged:Connect(function(i)
        if sDrag and i.UserInputType == Enum.UserInputType.MouseMovement then update(i.Position.X) end
    end)

    return Row, function() return current end
end

-- ── KEYBIND (suporta Mouse4/Mouse5/qualquer tecla) ──
local function createKeybind(parent, label, defaultBind, order, cb)
    local curBind  = defaultBind
    local listening = false
    local bindConn

    local Row = Instance.new("Frame")
    Row.Size             = UDim2.new(1, 0, 0, 38)
    Row.BackgroundColor3 = CONFIG.GUI.Panel
    Row.BorderSizePixel  = 0
    Row.LayoutOrder      = order or 0
    Row.Parent           = parent
    Instance.new("UICorner", Row).CornerRadius = UDim.new(0, 8)

    local Lbl = Instance.new("TextLabel")
    Lbl.Text           = label
    Lbl.Size           = UDim2.new(1, -112, 1, 0)
    Lbl.Position       = UDim2.new(0, 10, 0, 0)
    Lbl.BackgroundTransparency = 1
    Lbl.TextColor3     = CONFIG.GUI.Text
    Lbl.Font           = Enum.Font.Gotham
    Lbl.TextSize       = 13
    Lbl.TextXAlignment = Enum.TextXAlignment.Left
    Lbl.Parent         = Row

    local KeyBtn = Instance.new("TextButton")
    KeyBtn.Text          = "[  " .. getBindName(curBind) .. "  ]"
    KeyBtn.Size          = UDim2.new(0, 98, 0, 24)
    KeyBtn.Position      = UDim2.new(1, -106, 0.5, -12)
    KeyBtn.BackgroundColor3 = CONFIG.GUI.TabInactive
    KeyBtn.TextColor3    = CONFIG.GUI.Accent
    KeyBtn.Font          = Enum.Font.GothamBold
    KeyBtn.TextSize      = 11
    KeyBtn.BorderSizePixel = 0
    KeyBtn.Parent        = Row
    Instance.new("UICorner", KeyBtn).CornerRadius = UDim.new(0, 6)

    KeyBtn.MouseButton1Click:Connect(function()
        if listening then return end
        listening = true
        KeyBtn.Text      = "[ pressione... ]"
        KeyBtn.TextColor3 = Color3.fromRGB(255, 215, 50)

        task.wait(0.15)

        bindConn = UserInput.InputBegan:Connect(function(inp, gpe)
            if not listening then return end
            local newBind

            if inp.UserInputType == Enum.UserInputType.Keyboard then
                if inp.KeyCode == Enum.KeyCode.Escape then
                    listening = false
                    KeyBtn.Text      = "[  " .. getBindName(curBind) .. "  ]"
                    KeyBtn.TextColor3 = CONFIG.GUI.Accent
                    bindConn:Disconnect()
                    return
                end
                newBind = { isMouse = false, value = inp.KeyCode }
            elseif inp.UserInputType == Enum.UserInputType.MouseButton1 then
                newBind = { isMouse = true, value = Enum.UserInputType.MouseButton1 }
            elseif inp.UserInputType == Enum.UserInputType.MouseButton2 then
                newBind = { isMouse = true, value = Enum.UserInputType.MouseButton2 }
            elseif inp.UserInputType == Enum.UserInputType.MouseButton3 then
                newBind = { isMouse = true, value = Enum.UserInputType.MouseButton3 }
            end

            if newBind then
                curBind          = newBind
                listening        = false
                KeyBtn.Text      = "[  " .. getBindName(curBind) .. "  ]"
                KeyBtn.TextColor3 = CONFIG.GUI.Accent
                bindConn:Disconnect()
                if cb then cb(curBind) end
            end
        end)
    end)

    return Row
end

-- ══════════════════════════════════════════
--  ABA: VISUALS
-- ══════════════════════════════════════════
local vTab = Tabs.VISUALS
createSection(vTab, "  ESP / WALLHACK", 1)
createToggle(vTab, "ESP Wallhack", "Verde = visivel | Vermelho = atras da parede", false, 2, function(on)
    State.ESP = on
    if not on then
        for _, d in pairs(EspObjects) do
            if d.HL and d.HL.Parent then d.HL:Destroy() end
            if d.BB and d.BB.Parent then d.BB:Destroy() end
        end
        EspObjects = {}
        VisibilityCache = {}
    end
end)
createToggle(vTab, "Mostrar Nomes",    nil, true,  3, function(on) CONFIG.ESP.ShowNames    = on end)
createToggle(vTab, "Mostrar Distancia", nil, true, 4, function(on) CONFIG.ESP.ShowDistance = on end)
createToggle(vTab, "Barra de Vida (Vertical)", "Barra em pe ao lado do personagem", true, 5, function(on) CONFIG.ESP.ShowHealth   = on end)

-- ══════════════════════════════════════════
--  ABA: MOVEMENT
-- ══════════════════════════════════════════
local mTab = Tabs.MOVEMENT

createSection(mTab, "  FLY / VOO (Anti-TP)", 1)
createSlider(mTab, "Velocidade do Voo", 10, 250, 60, 0, " sp", 2, function(v)
    CONFIG.Fly.Speed = v
end)
createToggle(mTab, "Fly (Voar)", "Anti-teleport: move gradual sem pico", false, 3, function(on)
    State.Fly = on
    if on then enableFly() else disableFly() end
end)

createSection(mTab, "  SPEED HACK (Anti-TP)", 4)
createSlider(mTab, "Velocidade de Corrida", 16, 350, 50, 0, " sp", 5, function(v)
    CONFIG.Speed.Value = v
end)
createToggle(mTab, "Speed Hack", "Incremento gradual anti-deteccao", false, 6, function(on)
    State.Speed = on
    if on then enableSpeed() else disableSpeed() end
end)

-- ══════════════════════════════════════════
--  ABA: AIMBOT
-- ══════════════════════════════════════════
local aTab = Tabs.AIMBOT

createSection(aTab, "  AIMBOT", 1)
createToggle(aTab, "Aimbot", "Trava mira no inimigo visivel", false, 2, function(on)
    State.Aimbot   = on
    FovCircle.Visible = on
end)
createToggle(aTab, "Sempre Ativo (Aimbot)", "Ativa sem precisar segurar tecla", false, 3, function(on)
    CONFIG.Aimbot.AlwaysActive = on
end)
createKeybind(aTab, "Tecla do Aimbot", CONFIG.Aimbot.Bind, 4, function(bind)
    CONFIG.Aimbot.Bind = bind
end)
createSlider(aTab, "FOV  (raio de deteccao)", 30, 600, 150, 0, " px", 5, function(v)
    CONFIG.Aimbot.FOV = v
    FovCircle.Radius  = v
end)
createSlider(aTab, "Suavidade", 0.02, 0.9, 0.25, 2, "", 6, function(v)
    CONFIG.Aimbot.Smoothness = v
end)
createToggle(aTab, "So visivel (Aimbot)", "Nao trava em quem esta atras da parede", true, 7, function(on)
    CONFIG.Aimbot.OnlyVisible = on
end)

createSection(aTab, "  TRIGGERBOT", 8)
createToggle(aTab, "Triggerbot", "Atira auto quando mira em inimigo visivel", false, 9, function(on)
    State.Triggerbot = on
end)
createToggle(aTab, "Sempre Ativo (Trigger)", "Ativa sem precisar segurar tecla", false, 10, function(on)
    CONFIG.Triggerbot.AlwaysActive = on
end)
createKeybind(aTab, "Tecla do Trigger", CONFIG.Triggerbot.Bind, 11, function(bind)
    CONFIG.Triggerbot.Bind = bind
end)
createSlider(aTab, "Delay entre tiros", 0.01, 0.6, 0.06, 2, "s", 12, function(v)
    CONFIG.Triggerbot.Delay = v
end)
createToggle(aTab, "So visivel (Trigger)", "Nao atira em quem esta atras da parede", true, 13, function(on)
    CONFIG.Triggerbot.OnlyVisible = on
end)

createSection(aTab, "  ARMA", 14)
createToggle(aTab, "Sem Reload", "Recarregamento instant. + ammo infinita", false, 15, function(on)
    State.NoReload = on
end)

-- ══════════════════════════════════════════
--  LÓGICA: ESP (com visibilidade verde/vermelho e HP vertical)
-- ══════════════════════════════════════════
local function removeEsp(player)
    local d = EspObjects[player]
    if not d then return end
    if d.HL and d.HL.Parent then d.HL:Destroy() end
    if d.BB and d.BB.Parent then d.BB:Destroy() end
    EspObjects[player] = nil
    VisibilityCache[player] = nil
end

local function createEsp(player)
    if player == LocalPlayer then return end
    removeEsp(player)
    local char = player.Character
    if not char then return end

    local visible = isPlayerVisible(char)
    VisibilityCache[player] = visible

    local espColor = visible and CONFIG.ESP.ColorVisible or CONFIG.ESP.ColorHidden

    local hl = Instance.new("Highlight")
    hl.Adornee            = char
    hl.DepthMode          = Enum.HighlightDepthMode.AlwaysOnTop
    hl.FillColor          = espColor
    hl.FillTransparency   = CONFIG.ESP.FillTrans
    hl.OutlineColor       = espColor
    hl.OutlineTransparency = 0.3
    hl.Parent             = char

    local hrp = char:FindFirstChild("HumanoidRootPart")
    local bb  = Instance.new("BillboardGui")
    bb.Size        = UDim2.new(0, 140, 0, 60)
    bb.StudsOffset = Vector3.new(0, 4.0, 0)
    bb.AlwaysOnTop = true
    bb.Adornee     = hrp or char.PrimaryPart
    bb.Parent      = char

    local nameLbl = Instance.new("TextLabel")
    nameLbl.Size              = UDim2.new(1, -18, 0, 17)
    nameLbl.Position          = UDim2.new(0, 0, 0, 0)
    nameLbl.BackgroundTransparency = 1
    nameLbl.Text              = player.Name
    nameLbl.TextColor3        = espColor
    nameLbl.Font              = Enum.Font.GothamBold
    nameLbl.TextSize          = 13
    nameLbl.TextStrokeTransparency = 0.4
    nameLbl.TextStrokeColor3  = Color3.new(0,0,0)
    nameLbl.TextXAlignment    = Enum.TextXAlignment.Left
    nameLbl.Parent            = bb

    local distLbl = Instance.new("TextLabel")
    distLbl.Size              = UDim2.new(1, -18, 0, 12)
    distLbl.Position          = UDim2.new(0, 0, 0, 19)
    distLbl.BackgroundTransparency = 1
    distLbl.Text              = "0m"
    distLbl.TextColor3        = Color3.fromRGB(200, 200, 200)
    distLbl.Font              = Enum.Font.Gotham
    distLbl.TextSize          = 11
    distLbl.TextStrokeTransparency = 0.5
    distLbl.TextStrokeColor3  = Color3.new(0,0,0)
    distLbl.TextXAlignment    = Enum.TextXAlignment.Left
    distLbl.Parent            = bb

    -- HP Bar VERTICAL (em pe, lado direito, nao atrapalha a visao)
    local hpBg = Instance.new("Frame")
    hpBg.Size             = UDim2.new(0, 4, 0, 44)
    hpBg.Position         = UDim2.new(1, -8, 0, 2)
    hpBg.BackgroundColor3 = Color3.fromRGB(35, 35, 35)
    hpBg.BorderSizePixel  = 0
    hpBg.Parent           = bb
    Instance.new("UICorner", hpBg).CornerRadius = UDim.new(0, 2)

    -- HP Fill (cresce de baixo pra cima)
    local hpFill = Instance.new("Frame")
    hpFill.Size             = UDim2.new(1, 0, 1, 0)
    hpFill.Position         = UDim2.new(0, 0, 0, 0)
    hpFill.AnchorPoint      = Vector2.new(0, 1)
    hpFill.Position         = UDim2.new(0, 0, 1, 0)
    hpFill.BackgroundColor3 = Color3.fromRGB(80, 220, 80)
    hpFill.BorderSizePixel  = 0
    hpFill.Parent           = hpBg
    Instance.new("UICorner", hpFill).CornerRadius = UDim.new(0, 2)

    -- Texto HP pequeno embaixo
    local hpTxt = Instance.new("TextLabel")
    hpTxt.Size              = UDim2.new(1, -18, 0, 11)
    hpTxt.Position          = UDim2.new(0, 0, 0, 34)
    hpTxt.BackgroundTransparency = 1
    hpTxt.Text              = "100"
    hpTxt.TextColor3        = Color3.fromRGB(180, 180, 180)
    hpTxt.Font              = Enum.Font.Gotham
    hpTxt.TextSize          = 10
    hpTxt.TextStrokeTransparency = 0.5
    hpTxt.TextStrokeColor3  = Color3.new(0,0,0)
    hpTxt.TextXAlignment    = Enum.TextXAlignment.Left
    hpTxt.Parent            = bb

    EspObjects[player] = {
        HL     = hl,   BB     = bb,
        Name   = nameLbl, Dist = distLbl,
        HpBg   = hpBg, HpFill = hpFill, HpTxt = hpTxt,
    }
end

-- ══════════════════════════════════════════
--  LÓGICA: FLY (Anti-Teleport)
--  Em vez de usar BodyVelocity com velocidade alta,
--  usa CFrame incremental pequeno a cada frame
--  para parecer movimento natural e nao disparar o anticheat.
-- ══════════════════════════════════════════
enableFly = function()
    local char = LocalPlayer.Character
    if not char then return end
    local hrp = char:FindFirstChild("HumanoidRootPart")
    local hum = char:FindFirstChild("Humanoid")
    if not hrp or not hum then return end

    -- Desativa gravidade sem usar BodyVelocity grande
    FlyObjects.anchor = Instance.new("BodyVelocity")
    FlyObjects.anchor.Velocity  = Vector3.zero
    FlyObjects.anchor.MaxForce  = Vector3.new(1e5, 1e5, 1e5)
    FlyObjects.anchor.Parent    = hrp

    local gyro = Instance.new("BodyGyro")
    gyro.MaxTorque = Vector3.new(1e5, 1e5, 1e5)
    gyro.D         = 125
    gyro.CFrame    = hrp.CFrame
    gyro.Parent    = hrp
    FlyObjects.gyro = gyro

    FlyObjects.lastPos = hrp.Position

    FlyObjects.conn = RunService.Heartbeat:Connect(function(dt)
        if not State.Fly then disableFly() return end
        local c = LocalPlayer.Character
        if not c then return end
        local h = c:FindFirstChild("HumanoidRootPart")
        if not h then return end

        local dir = Vector3.zero
        if UserInput:IsKeyDown(Enum.KeyCode.W)         then dir += Camera.CFrame.LookVector  end
        if UserInput:IsKeyDown(Enum.KeyCode.S)         then dir -= Camera.CFrame.LookVector  end
        if UserInput:IsKeyDown(Enum.KeyCode.A)         then dir -= Camera.CFrame.RightVector end
        if UserInput:IsKeyDown(Enum.KeyCode.D)         then dir += Camera.CFrame.RightVector end
        if UserInput:IsKeyDown(Enum.KeyCode.Space)     then dir += Vector3.yAxis             end
        if UserInput:IsKeyDown(Enum.KeyCode.LeftShift) then dir -= Vector3.yAxis             end

        if dir.Magnitude > 0 then
            -- Move por CFrame incremental (anti-teleport)
            local step = dir.Unit * CONFIG.Fly.Speed * dt
            -- Limita o step maximo por frame pra nao parecer teleport
            local maxStep = 2.5
            if step.Magnitude > maxStep then
                step = step.Unit * maxStep
            end
            h.CFrame = h.CFrame + step
        end

        FlyObjects.anchor.Velocity = Vector3.zero
        gyro.CFrame = Camera.CFrame

        FlyObjects.lastPos = h.Position
    end)
end

disableFly = function()
    if FlyObjects.conn   then FlyObjects.conn:Disconnect();   FlyObjects.conn   = nil end
    if FlyObjects.anchor and FlyObjects.anchor.Parent then FlyObjects.anchor:Destroy() end
    if FlyObjects.gyro   and FlyObjects.gyro.Parent   then FlyObjects.gyro:Destroy()   end
    FlyObjects.anchor = nil
    FlyObjects.gyro   = nil
    FlyObjects.lastPos = nil
    local char = LocalPlayer.Character
    if char then
        local hum = char:FindFirstChild("Humanoid")
        if hum then hum.PlatformStand = false end
    end
end

-- ══════════════════════════════════════════
--  LÓGICA: SPEED (Anti-Teleport)
--  Em vez de definir WalkSpeed alto diretamente,
--  incrementa gradualmente e usa CFrame boost
--  para evitar deteccao por pico de velocidade.
-- ══════════════════════════════════════════
enableSpeed = function()
    local char = LocalPlayer.Character
    if not char then return end
    local hum = char:FindFirstChild("Humanoid")
    if not hum then return end

    -- Mantem WalkSpeed padrao para o servidor
    hum.WalkSpeed = 16

    SpeedObjects.conn = RunService.Heartbeat:Connect(function(dt)
        if not State.Speed then disableSpeed() return end
        local c = LocalPlayer.Character
        if not c then return end
        local h = c:FindFirstChild("HumanoidRootPart")
        local hu = c:FindFirstChild("Humanoid")
        if not h or not hu then return end

        -- Mantem walkspeed normal pro servidor
        hu.WalkSpeed = 16

        -- Calcula direcao do movimento do jogador
        local moveDir = hu.MoveDirection
        if moveDir.Magnitude > 0 then
            -- Boost extra via CFrame (aparece como lag suave)
            local extraSpeed = (CONFIG.Speed.Value - 16)
            if extraSpeed > 0 then
                local step = moveDir.Unit * extraSpeed * dt
                -- Limita step maximo pra nao parecer teleport
                local maxStep = 1.8
                if step.Magnitude > maxStep then
                    step = step.Unit * maxStep
                end
                h.CFrame = h.CFrame + step
            end
        end
    end)
end

disableSpeed = function()
    if SpeedObjects.conn then SpeedObjects.conn:Disconnect(); SpeedObjects.conn = nil end
    local char = LocalPlayer.Character
    if char then
        local hum = char:FindFirstChild("Humanoid")
        if hum then hum.WalkSpeed = 16 end
    end
end

-- ══════════════════════════════════════════
--  LÓGICA: AIMBOT (com check de visibilidade)
-- ══════════════════════════════════════════
local function getAimbotTarget()
    local bestDist   = CONFIG.Aimbot.FOV
    local bestTarget = nil
    local center     = Vector2.new(Camera.ViewportSize.X/2, Camera.ViewportSize.Y/2)

    for _, p in ipairs(Players:GetPlayers()) do
        if p == LocalPlayer then continue end
        local char = p.Character
        if not char then continue end
        local part = char:FindFirstChild(CONFIG.Aimbot.TargetPart) or char:FindFirstChild("Head")
        if not part then continue end
        local hum = char:FindFirstChild("Humanoid")
        if not hum or hum.Health <= 0 then continue end

        -- Check visibilidade: se OnlyVisible esta ativo, pula quem esta atras da parede
        if CONFIG.Aimbot.OnlyVisible then
            local vis = VisibilityCache[p]
            if vis == false then continue end
            -- Se nao tem cache, faz check direto
            if vis == nil then
                if not isPlayerVisible(char) then continue end
            end
        end

        local sp, onScreen = Camera:WorldToScreenPoint(part.Position)
        if not onScreen then continue end
        local d = (Vector2.new(sp.X, sp.Y) - center).Magnitude
        if d < bestDist then bestDist = d; bestTarget = part end
    end
    return bestTarget
end

-- ══════════════════════════════════════════
--  LOOP PRINCIPAL
-- ══════════════════════════════════════════
local visCheckTimer = 0

RunService.RenderStepped:Connect(function(dt)

    -- Timer pra check de visibilidade (nao faz todo frame, a cada 0.15s)
    visCheckTimer = visCheckTimer + dt

    -- ── ESP ──────────────────────────────
    if State.ESP then
        for _, p in ipairs(Players:GetPlayers()) do
            if p == LocalPlayer then continue end
            local char   = p.Character
            local myChar = LocalPlayer.Character
            if not char or not myChar then removeEsp(p) continue end
            local hrp  = char:FindFirstChild("HumanoidRootPart")
            local mhrp = myChar:FindFirstChild("HumanoidRootPart")
            if not hrp or not mhrp then removeEsp(p) continue end

            local dist = math.floor((hrp.Position - mhrp.Position).Magnitude)
            if dist > CONFIG.ESP.MaxDist then removeEsp(p) continue end

            if not EspObjects[p] then createEsp(p) end
            local d = EspObjects[p]
            if not d then continue end

            -- Atualiza visibilidade a cada ~0.15s
            if visCheckTimer >= 0.15 then
                local vis = isPlayerVisible(char)
                VisibilityCache[p] = vis
                local espColor = vis and CONFIG.ESP.ColorVisible or CONFIG.ESP.ColorHidden

                if d.HL then
                    d.HL.FillColor    = espColor
                    d.HL.OutlineColor = espColor
                end
                if d.Name then
                    d.Name.TextColor3 = espColor
                end
            end

            if d.Name then d.Name.Visible = CONFIG.ESP.ShowNames end
            if d.Dist then
                d.Dist.Visible = CONFIG.ESP.ShowDistance
                d.Dist.Text    = dist .. "m"
            end

            -- Barra de HP vertical
            if d.HpBg then
                local show = CONFIG.ESP.ShowHealth
                d.HpBg.Visible  = show
                d.HpTxt.Visible = show
                if show then
                    local hum = char:FindFirstChild("Humanoid")
                    if hum then
                        local hp    = math.max(0, hum.Health)
                        local maxhp = math.max(1, hum.MaxHealth)
                        local ratio = hp / maxhp
                        -- Barra vertical: tamanho Y proporcional, cresce de baixo pra cima
                        d.HpFill.Size             = UDim2.new(1, 0, ratio, 0)
                        d.HpFill.BackgroundColor3 = hpToColor(ratio)
                        d.HpTxt.Text              = math.floor(hp) .. "/" .. math.floor(maxhp)
                    end
                end
            end
        end

        if visCheckTimer >= 0.15 then
            visCheckTimer = 0
        end
    end

    -- ── FOV CIRCLE ───────────────────────
    FovCircle.Visible = State.Aimbot
    if State.Aimbot then
        FovCircle.Position = Vector2.new(Camera.ViewportSize.X/2, Camera.ViewportSize.Y/2)
        FovCircle.Radius   = CONFIG.Aimbot.FOV
    end

    -- ── AIMBOT ───────────────────────────
    if State.Aimbot then
        local shouldAim = CONFIG.Aimbot.AlwaysActive or isBindPressed(CONFIG.Aimbot.Bind)
        if shouldAim then
            local target = getAimbotTarget()
            if target then
                local goal = CFrame.new(Camera.CFrame.Position, target.Position)
                Camera.CFrame = Camera.CFrame:Lerp(goal, CONFIG.Aimbot.Smoothness)
            end
        end
    end

    -- ── TRIGGERBOT ───────────────────────
    if State.Triggerbot then
        local shouldTrigger = CONFIG.Triggerbot.AlwaysActive or isBindPressed(CONFIG.Triggerbot.Bind)
        if shouldTrigger then
            local now = tick()
            if now - lastTriggerTick >= CONFIG.Triggerbot.Delay then
                local cv  = Camera.ViewportSize
                local ray = Camera:ScreenPointToRay(cv.X/2, cv.Y/2)
                local rp  = RaycastParams.new()
                rp.FilterDescendantsInstances = { LocalPlayer.Character or workspace }
                rp.FilterType = Enum.RaycastFilterType.Exclude
                local hit = workspace:Raycast(ray.Origin, ray.Direction * 2500, rp)
                if hit and hit.Instance then
                    local model = hit.Instance:FindFirstAncestorOfClass("Model")
                    if model then
                        local hp = Players:GetPlayerFromCharacter(model)
                        if hp and hp ~= LocalPlayer then
                            -- Check visibilidade antes de atirar
                            local canShoot = true
                            if CONFIG.Triggerbot.OnlyVisible then
                                local vis = VisibilityCache[hp]
                                if vis == false then
                                    canShoot = false
                                elseif vis == nil then
                                    canShoot = isPlayerVisible(model)
                                end
                            end
                            if canShoot then
                                mouse1click()
                                lastTriggerTick = now
                            end
                        end
                    end
                end
            end
        end
    end

    -- ── NO RELOAD ────────────────────────
    if State.NoReload then
        local char = LocalPlayer.Character
        if char then
            local hum = char:FindFirstChild("Humanoid")
            local anim = hum and hum:FindFirstChild("Animator")
            if anim then
                for _, t in pairs(anim:GetPlayingAnimationTracks()) do
                    if t.Name:lower():find("reload") then
                        t:AdjustSpeed(50)
                    end
                end
            end
            local tool = char:FindFirstChildOfClass("Tool")
            if tool then
                for _, v in pairs(tool:GetDescendants()) do
                    if (v:IsA("IntValue") or v:IsA("NumberValue")) then
                        local n = v.Name:lower()
                        if n:find("ammo") or n:find("bullet") or n:find("clip") or n:find("mag") then
                            if v.Value < 5 then v.Value = 999 end
                        end
                    end
                end
            end
        end
    end
end)

-- ══════════════════════════════════════════
--  EVENTOS DE JOGADORES
-- ══════════════════════════════════════════
Players.PlayerAdded:Connect(function(p)
    p.CharacterAdded:Connect(function()
        task.wait(0.5)
        if State.ESP then createEsp(p) end
    end)
end)

Players.PlayerRemoving:Connect(function(p) removeEsp(p) end)

LocalPlayer.CharacterAdded:Connect(function(char)
    task.wait(1)
    disableFly()
    disableSpeed()
    if State.Fly   then enableFly() end
    if State.Speed then enableSpeed() end
    if State.ESP then
        EspObjects = {}
        VisibilityCache = {}
        for _, p in ipairs(Players:GetPlayers()) do createEsp(p) end
    end
end)

-- ══════════════════════════════════════════
--  ARRASTAR JANELA
-- ══════════════════════════════════════════
local dragging, dragStart, startPos = false, nil, nil

TitleBar.InputBegan:Connect(function(i)
    if i.UserInputType == Enum.UserInputType.MouseButton1 then
        dragging = true; dragStart = i.Position; startPos = Win.Position
    end
end)
TitleBar.InputEnded:Connect(function(i)
    if i.UserInputType == Enum.UserInputType.MouseButton1 then dragging = false end
end)
UserInput.InputChanged:Connect(function(i)
    if dragging and i.UserInputType == Enum.UserInputType.MouseMovement then
        local d = i.Position - dragStart
        Win.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X,
                                   startPos.Y.Scale, startPos.Y.Offset + d.Y)
    end
end)

-- ══════════════════════════════════════════
--  MINIMIZAR
-- ══════════════════════════════════════════
local FULL = UDim2.new(0, 290, 0, 450)
local MINI = UDim2.new(0, 290, 0, 38)

MinBtn.MouseButton1Click:Connect(function()
    State.Minimized = not State.Minimized
    TweenSvc:Create(Win, TweenInfo.new(0.22, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
        { Size = State.Minimized and MINI or FULL }):Play()
    MinBtn.Text = State.Minimized and "+" or "-"
end)

-- ══════════════════════════════════════════
--  FECHAR / CLEANUP
-- ══════════════════════════════════════════
CloseBtn.MouseButton1Click:Connect(function()
    disableFly()
    disableSpeed()
    local char = LocalPlayer.Character
    if char then
        local hum = char:FindFirstChild("Humanoid")
        if hum then hum.WalkSpeed = 16; hum.PlatformStand = false end
    end
    for _, d in pairs(EspObjects) do
        if d.HL and d.HL.Parent then d.HL:Destroy() end
        if d.BB and d.BB.Parent then d.BB:Destroy() end
    end
    EspObjects = {}
    VisibilityCache = {}
    pcall(function() FovCircle:Remove() end)
    ScreenGui:Destroy()
    print("[AuditPanel v4] Fechado e limpo.")
end)

-- ══════════════════════════════════════════
--  PRONTO!
-- ══════════════════════════════════════════
print("=============================================")
print("  Audit Panel v4.0 carregado!")
print("  ESP: Verde/Vermelho por visibilidade")
print("  HP Vertical | Aimbot/Trigger Always-On")
print("  Fly/Speed Anti-Teleport")
print("=============================================")
